import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../auth/jwt.js';

export type AuthenticatedRequest = FastifyRequest & {
  userId: string;
};

export function requireAuth(req: FastifyRequest): asserts req is AuthenticatedRequest {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('UNAUTHORIZED'), { statusCode: 401 });
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);
  if (!payload) {
    throw Object.assign(new Error('INVALID_TOKEN'), { statusCode: 401 });
  }

  (req as AuthenticatedRequest).userId = payload.sub;
}
