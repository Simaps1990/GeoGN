import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export type JwtUserPayload = {
  sub: string;
  jti: string;
  typ: 'access' | 'refresh';
  /** Ajouté automatiquement par jsonwebtoken (secondes depuis epoch). */
  iat?: number;
};

export function getJwtSecrets() {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!accessSecret) throw new Error('Missing JWT_ACCESS_SECRET');
  if (!refreshSecret) throw new Error('Missing JWT_REFRESH_SECRET');
  return { accessSecret, refreshSecret };
}

export function signAccessToken(userId: string) {
  const { accessSecret } = getJwtSecrets();
  const payload: JwtUserPayload = { sub: userId, jti: crypto.randomUUID(), typ: 'access' };
  return jwt.sign(payload, accessSecret, { expiresIn: '15m', algorithm: 'HS256' });
}

export function signRefreshToken(userId: string) {
  const { refreshSecret } = getJwtSecrets();
  const payload: JwtUserPayload = { sub: userId, jti: crypto.randomUUID(), typ: 'refresh' };
  return jwt.sign(payload, refreshSecret, { expiresIn: '30d', algorithm: 'HS256' });
}

export function verifyAccessToken(token: string): JwtUserPayload {
  const { accessSecret } = getJwtSecrets();
  const payload = jwt.verify(token, accessSecret, { algorithms: ['HS256'] }) as JwtUserPayload;
  if (payload.typ !== 'access') throw new Error('WRONG_TOKEN_TYPE');
  return payload;
}

export function verifyRefreshToken(token: string): JwtUserPayload {
  const { refreshSecret } = getJwtSecrets();
  const payload = jwt.verify(token, refreshSecret, { algorithms: ['HS256'] }) as JwtUserPayload;
  if (payload.typ !== 'refresh') throw new Error('WRONG_TOKEN_TYPE');
  return payload;
}
