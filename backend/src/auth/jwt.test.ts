import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } = await import(
  './jwt.js'
);

test('access token verifies as access and carries iat', () => {
  const payload = verifyAccessToken(signAccessToken('user-1'));
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.typ, 'access');
  assert.equal(typeof payload.iat, 'number');
});

test('refresh token verifies as refresh', () => {
  assert.equal(verifyRefreshToken(signRefreshToken('user-1')).typ, 'refresh');
});

test('a refresh token is rejected as an access token even with identical secrets', () => {
  process.env.JWT_REFRESH_SECRET = process.env.JWT_ACCESS_SECRET;
  const refreshToken = signRefreshToken('user-1');
  assert.throws(() => verifyAccessToken(refreshToken), /WRONG_TOKEN_TYPE/);
  assert.throws(() => verifyRefreshToken(signAccessToken('user-1')), /WRONG_TOKEN_TYPE/);
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
});
