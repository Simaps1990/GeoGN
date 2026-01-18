import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { connectMongo } from './db.js';
import './models/index.js';
import { authRoutes } from './routes/auth.js';
import { contactsRoutes } from './routes/contacts.js';
import { missionsRoutes } from './routes/missions.js';
import { invitesRoutes } from './routes/invites.js';
import { joinRequestsRoutes } from './routes/joinRequests.js';
import { poisRoutes } from './routes/pois.js';
import { personCasesRoutes } from './routes/personCases.js';
import { zonesRoutes } from './routes/zones.js';
import { vehicleTracksRoutes } from './routes/vehicleTracks.js';
import { oidcPlugin } from './routes/oidc.js';
import { setupSocket } from './socket.js';
import { startVehicleTrackScheduler } from './vehicleTrackScheduler.js';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error('Missing MONGO_URI');
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true, credentials: true });

// OIDC / Keycloak BFF SSO (cookies + server-side tokens)
if (process.env.OIDC_ISSUER_URL) {
  await app.register(oidcPlugin);
}

await connectMongo(mongoUri);

await authRoutes(app);
await contactsRoutes(app);
await missionsRoutes(app);
await invitesRoutes(app);
await joinRequestsRoutes(app);
await poisRoutes(app);
await personCasesRoutes(app);
await zonesRoutes(app);
await vehicleTracksRoutes(app);

app.get('/health', async () => ({ ok: true }));

setupSocket(app);
startVehicleTrackScheduler(app);

await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
