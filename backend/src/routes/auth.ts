import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { UserModel } from '../models/user.js';
import { generateAppUserId } from '../auth/appUserId.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.js';
import { requireAuth } from '../plugins/auth.js';

type RegisterBody = {
  email: string;
  password: string;
  displayName: string;
};

type LoginBody = {
  email: string;
  password: string;
};

type RefreshBody = {
  refreshToken: string;
};

type UpdateMeBody = {
  displayName?: string;
};

type ChangePasswordBody = {
  currentPassword: string;
  newPassword: string;
};

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>('/auth/register', async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    const { email, password, displayName } = req.body;

    const existing = await UserModel.findOne({ email }).lean();
    if (existing) {
      return reply.code(409).send({ error: 'EMAIL_ALREADY_USED' });
    }

    const passwordHash = await hashPassword(password);

    let appUserId = generateAppUserId();
    // Retry a few times in the unlikely event of collision
    for (let i = 0; i < 5; i++) {
      const collision = await UserModel.findOne({ appUserId }).lean();
      if (!collision) break;
      appUserId = generateAppUserId();
    }

    const user = await UserModel.create({
      appUserId,
      displayName,
      email,
      passwordHash,
      createdAt: new Date(),
    });

    const accessToken = signAccessToken(user._id.toString());
    const refreshToken = signRefreshToken(user._id.toString());

    return reply.send({
      accessToken,
      refreshToken,
      user: {
        id: user._id.toString(),
        appUserId: user.appUserId,
        displayName: user.displayName,
        email: user.email,
      },
    });
  });

  app.post<{ Body: LoginBody }>('/auth/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password } = req.body;

    const user = await UserModel.findOne({ email });
    if (!user) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const accessToken = signAccessToken(user._id.toString());
    const refreshToken = signRefreshToken(user._id.toString());

    return reply.send({
      accessToken,
      refreshToken,
      user: {
        id: user._id.toString(),
        appUserId: user.appUserId,
        displayName: user.displayName,
        email: user.email,
      },
    });
  });

  app.post<{ Body: RefreshBody }>('/auth/refresh', async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
    const { refreshToken } = req.body;

    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return reply.code(401).send({ error: 'INVALID_REFRESH_TOKEN' });
    }

    if (!mongoose.Types.ObjectId.isValid(payload.sub)) {
      return reply.code(401).send({ error: 'INVALID_REFRESH_TOKEN' });
    }

    const user = await UserModel.findById(payload.sub).lean();
    if (!user) {
      return reply.code(401).send({ error: 'INVALID_REFRESH_TOKEN' });
    }

    const newAccessToken = signAccessToken(user._id.toString());
    const newRefreshToken = signRefreshToken(user._id.toString());

    return reply.send({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  });

  app.get('/me', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const user = await UserModel.findById(req.userId).lean();
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    return reply.send({
      id: user._id.toString(),
      appUserId: user.appUserId,
      displayName: user.displayName,
      email: user.email,
    });
  });

  app.patch<{ Body: UpdateMeBody }>('/me', async (req: FastifyRequest<{ Body: UpdateMeBody }>, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const displayName = req.body.displayName;
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return reply.code(400).send({ error: 'DISPLAY_NAME_REQUIRED' });
    }

    const updated = await UserModel.findOneAndUpdate(
      { _id: req.userId },
      { $set: { displayName: displayName.trim() } },
      { new: true }
    ).lean();

    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    return reply.send({
      id: updated._id.toString(),
      appUserId: updated.appUserId,
      displayName: updated.displayName,
      email: updated.email,
    });
  });

  app.post<{ Body: ChangePasswordBody }>(
    '/me/password',
    async (req: FastifyRequest<{ Body: ChangePasswordBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return reply.code(400).send({ error: 'PASSWORD_REQUIRED' });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return reply.code(400).send({ error: 'WEAK_PASSWORD' });
      }

      const user = await UserModel.findById(req.userId);
      if (!user) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) {
        return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
      }

      user.passwordHash = await hashPassword(newPassword);
      await user.save();

      return reply.send({ ok: true });
    }
  );
}
