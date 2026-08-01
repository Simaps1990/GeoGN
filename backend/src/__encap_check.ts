import Fastify from 'fastify';
import oidcPlugin from './routes/oidc.js';

const app = Fastify();
await app.register(oidcPlugin);
// route registered on the ROOT instance, like authRoutes(app)
app.get('/root-cookies', async (req) => ({ cookies: (req as any).cookies ?? null }));

const res = await app.inject({ method: 'GET', url: '/root-cookies', headers: { cookie: 'bff_session=abc123' } });
console.log('root-scope req.cookies =', res.body);
await app.close();
