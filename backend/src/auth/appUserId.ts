import crypto from 'crypto';

export function generateAppUserId() {
  return crypto.randomBytes(9).toString('hex');
}
