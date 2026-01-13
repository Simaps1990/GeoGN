import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import crypto from 'crypto';
import * as oidc from 'openid-client';

// The typings bundled with openid-client in this environment don't expose
// Client/TokenSet/Issuer/generators as named members on the namespace type,
// so we use loose "any" aliases to avoid TypeScript errors while still
// calling the real runtime API.
type Client = any;
type TokenSet = any;

interface OidcSessionData {
  codeVerifier?: string;
  state?: string;
  tokens?: TokenSet;
  user?: any;
}

const sessionStore = new Map<string, OidcSessionData>();

let oidcClientPromise: Promise<Client> | null = null;

async function getOidcClient(): Promise<Client> {
  if (!oidcClientPromise) {
    const issuerUrl = process.env.OIDC_ISSUER_URL;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    const backendBaseUrl = process.env.BACKEND_BASE_URL;

    if (!issuerUrl || !clientId || !clientSecret || !backendBaseUrl) {
      throw new Error('Missing OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET or BACKEND_BASE_URL');
    }

    oidcClientPromise = (async () => {
      const issuer = await (oidc as any).Issuer.discover(issuerUrl);
      return new issuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [`${backendBaseUrl}/api/oidc/callback`],
        response_types: ['code'],
      });
    })();
  }

  return oidcClientPromise;
}

function getOrCreateSessionId(req: FastifyRequest, reply: FastifyReply): string {
  const existing = ((req as any).cookies as any)?.bff_session as string | undefined;
  if (existing) {
    return existing;
  }

  const sessionId = crypto.randomUUID();

  const isProd = process.env.NODE_ENV === 'production';
  (reply as any).setCookie('bff_session', sessionId, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours
  });

  return sessionId;
}

export async function oidcPlugin(app: FastifyInstance) {
  const sessionSecret = process.env.BFF_SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('Missing BFF_SESSION_SECRET');
  }

  await app.register(cookie, {
    secret: sessionSecret,
  });

  app.get('/api/login', async (req, reply) => {
    const client = await getOidcClient();

    const sessionId = getOrCreateSessionId(req, reply);

    const generators = (oidc as any).generators;
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();

    const existing = sessionStore.get(sessionId) ?? {};
    sessionStore.set(sessionId, { ...existing, codeVerifier, state });

    const backendBaseUrl = process.env.BACKEND_BASE_URL!;

    const authorizationUrl = client.authorizationUrl({
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      redirect_uri: `${backendBaseUrl}/api/oidc/callback`,
    });

    return reply.redirect(authorizationUrl);
  });

  app.get<{
    Querystring: {
      code?: string;
      state?: string;
    };
  }>('/api/oidc/callback', async (req, reply) => {
    const client = await getOidcClient();

    const sessionId = ((req as any).cookies as any)?.bff_session as string | undefined;
    if (!sessionId) {
      return reply.code(400).send({ error: 'SESSION_MISSING' });
    }

    const session = sessionStore.get(sessionId);
    if (!session || !session.codeVerifier || !session.state) {
      return reply.code(400).send({ error: 'SESSION_EXPIRED' });
    }

    const { code, state } = req.query;

    if (!code || !state || state !== session.state) {
      return reply.code(400).send({ error: 'INVALID_STATE' });
    }

    const backendBaseUrl = process.env.BACKEND_BASE_URL!;
    const redirectUri = `${backendBaseUrl}/api/oidc/callback`;

    const tokenSet = await client.callback(
      redirectUri,
      { code, state },
      {
        code_verifier: session.codeVerifier,
        state,
      }
    );

    const userinfo = await client.userinfo(tokenSet.access_token!);

    sessionStore.set(sessionId, {
      ...session,
      tokens: tokenSet,
      user: userinfo,
    });

    const frontendBaseUrl = process.env.FRONTEND_BASE_URL ?? '/';

    return reply.redirect(frontendBaseUrl);
  });

  app.get('/api/me', async (req, reply) => {
    const sessionId = ((req as any).cookies as any)?.bff_session as string | undefined;
    if (!sessionId) {
      return reply.send({ authenticated: false });
    }

    const session = sessionStore.get(sessionId);
    if (!session || !session.tokens || !session.user) {
      return reply.send({ authenticated: false });
    }

    return reply.send({ authenticated: true, user: session.user });
  });

  app.post('/api/logout', async (req, reply) => {
    const sessionId = ((req as any).cookies as any)?.bff_session as string | undefined;
    if (sessionId) {
      sessionStore.delete(sessionId);
    }

    (reply as any).clearCookie('bff_session', { path: '/' });

    return reply.send({ ok: true });
  });
}
