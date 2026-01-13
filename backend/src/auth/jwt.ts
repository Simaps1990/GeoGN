import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export type JwtUserPayload = {
  sub: string;
  jti: string;
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
  const payload: JwtUserPayload = { sub: userId, jti: crypto.randomUUID() };
  return jwt.sign(payload, accessSecret, { expiresIn: '15m' });
}

export function signRefreshToken(userId: string) {
  const { refreshSecret } = getJwtSecrets();
  const payload: JwtUserPayload = { sub: userId, jti: crypto.randomUUID() };
  return jwt.sign(payload, refreshSecret, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): JwtUserPayload {
  const { accessSecret } = getJwtSecrets();
  return jwt.verify(token, accessSecret) as JwtUserPayload;
}

export function verifyRefreshToken(token: string): JwtUserPayload {
  const { refreshSecret } = getJwtSecrets();
  return jwt.verify(token, refreshSecret) as JwtUserPayload;
}
