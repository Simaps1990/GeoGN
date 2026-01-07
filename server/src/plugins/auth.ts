import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../auth/jwt.js';

export type AuthenticatedRequest = FastifyRequest & {
  userId: string;
};

export function requireAuth(req: FastifyRequest): asserts req is AuthenticatedRequest {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
  const token = auth.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    (req as AuthenticatedRequest).userId = payload.sub;
  } catch {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
}
