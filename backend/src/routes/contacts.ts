import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { ContactModel } from '../models/contact.js';
import { UserModel } from '../models/user.js';

type CreateContactBody = {
  appUserId: string;
  alias?: string;
};

type UpdateContactBody = {
  alias?: string;
};

export async function contactsRoutes(app: FastifyInstance) {
  app.get('/contacts', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const contacts = await ContactModel.find({ ownerUserId: req.userId })
      .sort({ createdAt: -1 })
      .lean();

    const contactUserIds = contacts.map((c) => c.contactUserId);
    const users = await UserModel.find({ _id: { $in: contactUserIds } })
      .select({ displayName: 1, appUserId: 1 })
      .lean();

    const userById = new Map(users.map((u) => [u._id.toString(), u] as const));

    return reply.send(
      contacts.map((c) => {
        const u = userById.get(c.contactUserId.toString());
        return {
          id: c._id.toString(),
          alias: c.alias ?? null,
          createdAt: c.createdAt,
          contact: u
            ? {
                id: u._id.toString(),
                appUserId: u.appUserId,
                displayName: u.displayName,
              }
            : null,
        };
      })
    );
  });

  app.post<{ Body: CreateContactBody }>('/contacts', async (req: FastifyRequest<{ Body: CreateContactBody }>, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { appUserId, alias } = req.body;
    const contactUser = await UserModel.findOne({ appUserId }).lean();
    if (!contactUser) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    }

    if (contactUser._id.toString() === req.userId) {
      return reply.code(400).send({ error: 'CANNOT_ADD_SELF' });
    }

    try {
      const doc = await ContactModel.create({
        ownerUserId: new mongoose.Types.ObjectId(req.userId),
        contactUserId: contactUser._id,
        alias,
        createdAt: new Date(),
      });

      return reply.code(201).send({
        id: doc._id.toString(),
        alias: doc.alias ?? null,
        createdAt: doc.createdAt,
        contact: {
          id: contactUser._id.toString(),
          appUserId: contactUser.appUserId,
          displayName: contactUser.displayName,
        },
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        return reply.code(409).send({ error: 'ALREADY_IN_CONTACTS' });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: UpdateContactBody }>('/contacts/:id', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.code(400).send({ error: 'INVALID_ID' });
    }

    const updated = await ContactModel.findOneAndUpdate(
      { _id: id, ownerUserId: req.userId },
      { $set: { alias: req.body.alias } },
      { new: true }
    ).lean();

    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    return reply.send({ id: updated._id.toString(), alias: updated.alias ?? null, createdAt: updated.createdAt });
  });

  app.delete<{ Params: { id: string } }>('/contacts/:id', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.code(400).send({ error: 'INVALID_ID' });
    }

    const res = await ContactModel.deleteOne({ _id: id, ownerUserId: req.userId });
    if (res.deletedCount === 0) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    return reply.send({ ok: true });
  });
}
