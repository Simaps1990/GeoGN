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
  // Real bcryptjs-generated hash (cost 12) for a known plaintext, generated with the
  // bcryptjs package before this project switched to native bcrypt. Asserting `true`
  // here — unlike a mismatched-password check, which would pass even if bcrypt could
  // not read bcryptjs hashes at all — is what actually proves existing users' stored
  // password hashes still verify correctly after the swap.
  const BCRYPTJS_HASH = '$2b$12$ywP4Pv4HfJmzwf3.L7v23eIXEuXpA8rjbq44iWbJK0wlPA/RtsXya';
  assert.equal(await verifyPassword('CorrectHorseBatteryStaple!42', BCRYPTJS_HASH), true);
  assert.equal(await verifyPassword('wrong password', BCRYPTJS_HASH), false);
});

test('native bcrypt rejects the dummy timing-safety hash for any input (sanity check)', async () => {
  // DUMMY_PASSWORD_HASH from routes/auth.ts's login timing-safety compare — not a real
  // user's password, just needs to consume real bcrypt CPU time without matching.
  const DUMMY_PASSWORD_HASH = '$2a$12$lt1soyXupC3YJJ.qx9w/XuC6VSb52mcgwY9UlOa3TH5N1WRUp2bjG';
  assert.equal(await verifyPassword('anything', DUMMY_PASSWORD_HASH), false);
});
