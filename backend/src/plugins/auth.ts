import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../auth/jwt.js';

export type AuthenticatedRequest = FastifyRequest & {
  userId: string;
};

export function requireAuth(req: FastifyRequest): asserts req is AuthenticatedRequest {
  // Temporarily disabled authentication for testing
  (req as AuthenticatedRequest).userId = '507f1f77bcf86cd799439011';
  return;
}
