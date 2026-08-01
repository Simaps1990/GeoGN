import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { UserModel } from '../models/user.js';
import { generateAppUserId } from '../auth/appUserId.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.js';
import { requireAuth } from '../plugins/auth.js';
import { getBffUserFromRequest } from './oidc.js';
import { isAllowedOrigin } from '../corsOrigins.js';

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

const AUTH_RATE_LIMIT = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

// Hash bcrypt (cost 12, comme hashPassword) d'un mot de passe factice. Utilisé pour
// consommer le même temps CPU quand l'email est inconnu, afin de ne pas révéler
// l'existence d'un compte par le temps de réponse.
const DUMMY_PASSWORD_HASH = '$2a$12$lt1soyXupC3YJJ.qx9w/XuC6VSb52mcgwY9UlOa3TH5N1WRUp2bjG';

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : undefined;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive exact match. Login/register normalize new emails to lowercase,
// but accounts created before that existed may still hold a mixed-case email.
const findUserByEmailCI = (email: string) =>
  UserModel.findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    AUTH_RATE_LIMIT,
    async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const { email, password, displayName } = req.body;

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
        return reply.code(400).send({ error: 'INVALID_EMAIL' });
      }
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({ error: 'PASSWORD_TOO_SHORT' });
      }

      const existing = await findUserByEmailCI(normalizedEmail).lean();
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
        email: normalizedEmail,
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
    }
  );

	// Attache la session Keycloak (BFF) à un utilisateur applicatif et émet les JWT
	// comme pour /auth/login. Utilisé après un login SSO pour que les autorisations
	// backend (requireAuth) fonctionnent de la même façon.
	app.post('/auth/oidc/attach', async (req: FastifyRequest, reply: FastifyReply) => {
		// Défense en profondeur CSRF : la route émet des JWT à partir d'un cookie ambiant.
		// Une origine explicite non autorisée est rejetée ; une origine absente est traitée
		// comme same-origin/fiable, comme le callback CORS de index.ts.
		const origin = req.headers.origin;
		if (origin && !isAllowedOrigin(origin)) {
			return reply.code(403).send({ error: 'INVALID_ORIGIN' });
		}

		const bffUser = getBffUserFromRequest(req);
		if (!bffUser) {
			return reply.code(401).send({ error: 'BFF_SESSION_MISSING' });
		}

		const sub = String(bffUser.sub ?? bffUser.id ?? '').trim();
		const email = typeof bffUser.email === 'string' ? bffUser.email.trim().toLowerCase() : undefined;
		const displayNameRaw =
			bffUser.name ?? bffUser.preferred_username ?? bffUser.given_name ?? bffUser.email ?? bffUser.sub ?? 'Utilisateur SSO';
		const displayName = String(displayNameRaw).trim() || 'Utilisateur SSO';
		if (!sub && !email) {
			return reply.code(400).send({ error: 'OIDC_USER_INCOMPLETE' });
		}

		const emailVerified = bffUser.email_verified === true;
		const existing = email ? await UserModel.findOne({ email }).lean() : null;
		if (existing && !emailVerified) {
			return reply.code(409).send({ error: 'EMAIL_NOT_VERIFIED_LINK_REFUSED' });
		}

		// On essaie de retrouver un utilisateur existant par email si possible, sinon par un appUserId dérivé de sub.
		const appUserIdFromSub = sub ? `oidc:${sub}` : undefined;
		const query: any[] = [];
		if (email) query.push({ email });
		if (appUserIdFromSub) query.push({ appUserId: appUserIdFromSub });
		let user = existing ?? await UserModel.findOne(query.length ? { $or: query } : {}).exec();

		if (!user) {
			// Crée un utilisateur "virtuel" avec un mot de passe aléatoire (jamais utilisé côté login).
			let appUserId = appUserIdFromSub ?? generateAppUserId();
			for (let i = 0; i < 5; i += 1) {
				const collision = await UserModel.findOne({ appUserId }).lean();
				if (!collision) break;
				appUserId = generateAppUserId();
			}
			const randomPassword = `oidc:${crypto.randomUUID()}`;
			const passwordHash = await hashPassword(randomPassword);
			user = await UserModel.create({
				appUserId,
				displayName,
				email,
				passwordHash,
				createdAt: new Date(),
			});
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

  app.post<{ Body: LoginBody }>('/auth/login', AUTH_RATE_LIMIT, async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password } = req.body;

    const normalizedEmail = normalizeEmail(email);
    const candidatePassword = typeof password === 'string' ? password : '';
    const user = normalizedEmail ? await findUserByEmailCI(normalizedEmail) : null;
    if (!user) {
      // Consomme le même coût bcrypt que le cas "utilisateur trouvé" pour ne pas
      // révéler l'existence de l'email via le temps de réponse.
      await verifyPassword(candidatePassword, DUMMY_PASSWORD_HASH);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const ok = await verifyPassword(candidatePassword, user.passwordHash);
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

  app.post<{ Body: RefreshBody }>('/auth/refresh', AUTH_RATE_LIMIT, async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
    const { refreshToken } = req.body;

    let payload: { sub: string; iat?: number };
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

    // Un changement de mot de passe révoque tous les refresh tokens émis avant.
    // iat est en secondes, passwordChangedAt en millisecondes.
    const passwordChangedAtSec = user.passwordChangedAt
      ? Math.floor(user.passwordChangedAt.getTime() / 1000)
      : 0;
    if (typeof payload.iat === 'number' && payload.iat < passwordChangedAtSec) {
      return reply.code(401).send({ error: 'REFRESH_TOKEN_REVOKED' });
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
    AUTH_RATE_LIMIT,
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
      user.passwordChangedAt = new Date();
      await user.save();

      // passwordChangedAt revokes every refresh token issued before this instant,
      // including the one the caller is currently holding — reissue a fresh pair
      // so this request doesn't end in a surprise logout.
      const accessToken = signAccessToken(user._id.toString());
      const refreshToken = signRefreshToken(user._id.toString());

      return reply.send({ ok: true, accessToken, refreshToken });
    }
  );
}
