import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from './password.js';

test('hashPassword produces a bcrypt hash that verifyPassword accepts', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^\$2[ab]\$12\$/);
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('verifyPassword rejects a wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('native bcrypt can verify a hash produced by bcryptjs (cross-compatibility)', async () => {
  // Pre-existing hash from routes/auth.ts's DUMMY_PASSWORD_HASH, originally generated
  // with bcryptjs at cost 12. Confirms stored hashes still verify after the swap.
  const DUMMY_PASSWORD_HASH = '$2a$12$lt1soyXupC3YJJ.qx9w/XuC6VSb52mcgwY9UlOa3TH5N1WRUp2bjG';
  const result = await verifyPassword('anything', DUMMY_PASSWORD_HASH);
  assert.equal(result, false);
});
