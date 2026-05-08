import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../auth/jwt.js';

export type AuthenticatedRequest = FastifyRequest & {
  userId: string;
};

export function requireAuth(req: FastifyRequest): asserts req is AuthenticatedRequest {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    const error = new Error('UNAUTHORIZED') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }

  const token = authHeader.slice('Bearer '.length);
  const payload = verifyAccessToken(token);
  (req as AuthenticatedRequest).userId = payload.sub;
}
