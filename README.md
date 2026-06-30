# GeoGN — Guide du Développeur

## Qu'est-ce que GeoGN ?

GeoGN est une application web de coordination opérationnelle géolocalisée. Des équipes (secours, patrouilles, opérations de terrain...) peuvent :

- Voir en temps réel les positions GPS de chaque membre sur une carte interactive
- Tracer l'historique des déplacements de chaque participant
- Créer et gérer des **zones** géographiques avec un système de **grilles** et d'assignations
- Ouvrir une **piste** (fiche personne ou piste véhicule) pour modéliser la zone de recherche probable
- Poser des **POI** (points d'intérêt) sur la carte
- Gérer les **contacts** de mission
- Recevoir des notifications en temps réel via WebSocket

**Déploiement actuel :**
- Backend → **Render** (Node.js/Fastify)
- Frontend → **Netlify** (React/Vite)
- Base de données → **MongoDB** (cloud, hors Render)

---

## Architecture du Projet

GeoGN est un **monorepo** (backend + frontend dans le même dépôt git) :

```
GeoGN/
├── backend/
│   ├── src/
│   │   ├── models/       # Schémas Mongoose (MongoDB)
│   │   ├── routes/       # Routes API REST (Fastify)
│   │   ├── plugins/      # Auth JWT, CORS, cookies
│   │   ├── corsOrigins.ts# Règles CORS partagées HTTP + WebSocket
│   │   ├── db.ts         # Connexion MongoDB
│   │   ├── socket.ts     # Serveur WebSocket (Socket.IO)
│   │   └── index.ts      # Point d'entrée Fastify
│   ├── .env              # Variables d'environnement (ne pas committer)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/   # Composants réutilisables
│   │   │   ├── MapLibreMap.tsx       # Composant carte principal (>8000 lignes)
│   │   │   ├── MapRightToolbar.tsx   # Barre d'outils droite (grid, paw, settings...)
│   │   │   ├── PersonPanelOverlay.tsx# Panneau piste / fiche personne
│   │   │   └── ConfirmDialog.tsx     # Dialog de confirmation (portal React)
│   │   ├── pages/        # Pages de l'app (routes React Router)
│   │   │   ├── MissionMapPage.tsx    # Page carte mission
│   │   │   ├── MissionContactsPage.tsx
│   │   │   ├── MissionZonesPage.tsx
│   │   │   ├── MissionPoisPage.tsx
│   │   │   └── ...
│   │   ├── contexts/     # Contextes React (auth, mission...)
│   │   ├── hooks/        # Hooks personnalisés (géolocalisation...)
│   │   └── lib/          # Utilitaires (socket, API, helpers...)
│   └── package.json
├── docker-compose.yml    # MongoDB locale pour développement
└── README.md
```

---

## Technologies

### Backend
| Technologie | Usage |
|---|---|
| **Fastify 4** | Framework HTTP REST |
| **Socket.IO** | WebSocket temps réel |
| **MongoDB + Mongoose** | Base de données NoSQL |
| **TypeScript** | Typage statique |
| **tsx watch** | Dev server avec hot-reload |
| **bcryptjs** | Hash des mots de passe |
| **JWT (jsonwebtoken)** | Auth sans session serveur |
| **Keycloak/OIDC** | Auth SSO (suspendu, prêt à réactiver) |

### Frontend
| Technologie | Usage |
|---|---|
| **React 18** | Framework UI |
| **React Router v6** | Navigation SPA |
| **MapLibreGL** | Carte interactive (alternative open-source Mapbox) |
| **Tailwind CSS 3** | Style utilitaire |
| **Socket.IO-client** | Client WebSocket |
| **Vite** | Build tool et dev server |
| **TypeScript** | Typage statique |
| **Lucide React** | Icônes |

---

## Authentification

### Situation actuelle : JWT natif

Keycloak/OIDC est **suspendu** (routes `oidc.ts` conservées mais désactivées). L'application utilise son propre système JWT :

- `POST /auth/login` → vérifie email/password, retourne access + refresh token
- `POST /auth/refresh` → échange le refresh token contre un nouveau access token
- `POST /auth/logout` → invalide la session

Chaque route protégée appelle en premier :
```typescript
try {
  requireAuth(req); // plugins/auth.ts — vérifie le JWT, injecte req.userId
} catch (e: any) {
  return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
}
```

`requireAuth` est **indépendant de Keycloak** — toutes les 42+ routes l'appellent directement dans leur handler.

### Réactivation de Keycloak

Quand Keycloak sera réactivé, modifier `plugins/auth.ts` pour valider les tokens OIDC au lieu des JWT natifs. Toutes les routes sont déjà prêtes, aucun changement dans les handlers.

---

## Concepts Clés

### Missions
Groupe de travail central de l'application.

**États :** `draft` → `active` → `closed`

**Contient :** nom, état, style de carte MapLibre, durée de rétention des traces GPS, timer optionnel.

### Membres d'une Mission
**Rôles :**
- `admin` : gestion complète (membres, zones, assignations, piste personne...)
- `member` : participation, peut envoyer sa position
- `viewer` : lecture seule

Soft-delete via `removedAt` — un membre retiré n'est jamais vraiment supprimé.

### GPS et Traces

**Deux types de stockage :**
- `PositionCurrent` : position actuelle de chaque membre (1 doc par membre, mis à jour en place)
- `Trace` : historique complet pour dessiner les lignes sur la carte — TTL automatique via `expiresAt`
- `Position` : archive longue durée (TTL 90 jours via index MongoDB)

**Throttle :** 1 point Trace toutes les 2 secondes en temps réel. Exception : `position:bulk` (offline flush) est sans throttle pour préserver la fidélité.

### Zones et Grilles

Les zones sont des polygones ou cercles dessinés sur la carte par les admins.

**Grilles :**
- Une zone peut avoir une grille (lignes × colonnes)
- Chaque cellule a un code (`A1`, `B2`, etc.)
- Les admins assignent des membres à des cellules spécifiques
- Sans grille : assignation à la zone entière

**Modes d'affichage grille (frontend) :**
- `off` : pas de grille visible
- `admin-select` : admin sélectionne des cellules
- `member-highlight` : membres voient leurs cellules surlignées

### POI (Points d'Intérêt)
Points marqués sur la carte avec une icône, une couleur et une description. Soft-delete via `deletedAt`.

### Fiche Personne / Piste (PersonCase)

Quand on cherche une personne disparue, on crée une **fiche personne** avec :
- Dernière position connue (adresse ou POI)
- Date/heure de dernière observation
- Mobilité (à pied, vélo, voiture, etc.)
- Âge, sexe, état de santé, maladies, blessures
- Terrain, médicaments/substances

Cette fiche alimente un **modèle probabiliste gaussien** qui dessine un disque rouge sur la carte (zone de recherche probable).

**Un seul PersonCase par mission à la fois.**

### Piste Véhicule (VehicleTrack)

Pour les mobilités motorisées (voiture, moto, etc.), une piste véhicule est créée en parallèle. Elle utilise un algorithme `road_graph` pour calculer la zone accessible depuis le point de départ. Résultat : un polygone rouge (isochrone) affiché sur la carte via la source MapLibre `vehicle-track-reached`.

### Contacts
Liste de contacts liée à une mission (personnes à prévenir, équipes partenaires...). Stockée dans `Contact`.

---

## Système de Notifications

### Logique générale

Toutes les notifications suivent le même principe : **l'icône affiche un indicateur quand son contenu est caché**.

### Bouton Paw (piste personne)

- **Point rouge sur l'icône Paw** = `projectionNotification` = `!!personCase && !personPanelOpen`
  - Piste active ET panneau paw **fermé** → notification visible
  - Panneau paw **ouvert** (tu vois le disque) → notification disparaît
  - Piste supprimée → notification disparaît

### Bouton Grid (grille)

- **Point rouge sur l'icône Grid** = `gridHasAssignments && gridViewMode === 'off'`
  - Des cellules sont assignées ET le mode grille est **désactivé** → notification visible
  - Mode grille **actif** (tu vois la grille) → notification disparaît

### Bouton Paramètres (settings)

- **Badge numérique** sur l'icône Settings :

```typescript
const count =
  (projectionNotification ? 1 : 0) +
  (gridHasAssignments && gridViewMode === 'off' ? 1 : 0);
```

| Situation | Badge |
|---|---|
| Aucune piste, pas de grille | rien |
| Piste active (panneau fermé), pas de grille | **1** |
| Pas de piste, grille avec assignations (grid off) | **1** |
| Piste active (panneau fermé) + grille avec assignations (grid off) | **2** |
| Panneau paw ouvert + grille off avec assignations | **1** (paw visible = pas compté) |

Le badge est affiché en dehors du conteneur `overflow-hidden` (z-index absolu) pour ne pas être tronqué.

---

## WebSocket — Événements Temps Réel

### Rooms Socket.IO

- `mission:{missionId}` → tous les membres connectés d'une mission
- `user:{userId}` → notifications personnelles

### Client → Serveur

| Événement | Description |
|---|---|
| `mission:join` | Rejoindre une mission (vérifie membership, envoie snapshot) |
| `position:update` | Envoyer sa position GPS en temps réel |
| `position:bulk` | Flush des positions accumulées offline |

### Serveur → Client

| Événement | Description |
|---|---|
| `mission:joined` | Confirmation de join |
| `mission:snapshot` | Toutes les positions + traces actuelles |
| `position:update` | Position d'un membre (broadcast room) |
| `position:bulk` | Positions offline d'un membre (broadcast room) |
| `position:clear` | Retirer les positions d'un membre (kick) |
| `member:updated` | Changement rôle/couleur d'un membre |
| `join-request:created` | Nouvelle demande de join (→ admins) |
| `join-request:resolved` | Demande acceptée/refusée |
| `mission:deleted` | Mission supprimée (redirect clients) |
| `zone:created` | Nouvelle zone |
| `zone:updated` | Zone modifiée |
| `zone:deleted` | Zone supprimée |
| `zone:assignments:changed` | Assignations mises à jour |
| `zone:assigned:you` | Tu as été assigné à une zone (→ toi seulement) |
| `poi:created` | Nouveau POI |
| `poi:updated` | POI modifié |
| `poi:deleted` | POI supprimé |
| `person-case:created` | Fiche personne créée |
| `person-case:updated` | Fiche personne modifiée |
| `person-case:deleted` | Fiche personne supprimée |
| `vehicle-track:created` | Piste véhicule créée |
| `vehicle-track:updated` | Piste véhicule mise à jour (isochrone calculé) |

### Cache Socket

Pour éviter une requête MongoDB à chaque `position:update`, le serveur cache en mémoire socket :
```typescript
{ memberColor, retentionSeconds, checkedAt }
```
TTL : 30 secondes. Invalidé sur kick/changement rôle ou couleur.

---

## Base de Données (MongoDB)

### Collections et Modèles

| Collection | Fichier | Description |
|---|---|---|
| `missions` | `mission.ts` | Missions (nom, état, config) |
| `missionMembers` | `missionMember.ts` | Membres avec soft-delete (`removedAt`) |
| `missionInvites` | `missionInvite.ts` | Invitations tokenisées |
| `missionJoinRequests` | `missionJoinRequest.ts` | Demandes de join |
| `positionCurrents` | `positionCurrent.ts` | Position GPS courante (1 par membre) |
| `traces` | `trace.ts` | Historique GPS avec TTL (`expiresAt`) |
| `positions` | `position.ts` | Archive GPS — TTL 90 jours |
| `zones` | `zone.ts` | Zones géographiques + grilles |
| `pois` | `poi.ts` | POI avec soft-delete (`deletedAt`) |
| `personCases` | `personCase.ts` | Fiche personne (1 par mission) |
| `vehicleTracks` | `vehicleTrack.ts` | Pistes véhicule |
| `huntIsochrones` | `huntIsochrone.ts` | Isochrones calculés — TTL 30 jours |
| `contacts` | `contact.ts` | Contacts de mission |
| `users` | `user.ts` | Comptes utilisateurs |

### Indexes Importants

```typescript
// PositionCurrent — unique par membre
{ missionId: 1, userId: 1 } (unique)

// Trace — requêtes rapides par mission/user
{ missionId: 1, userId: 1, createdAt: -1 }
{ expiresAt: 1 } // TTL

// Position — archive avec TTL 90 jours
{ createdAt: 1 } // TTL, expireAfterSeconds: 7_776_000

// HuntIsochrone — TTL 30 jours
{ ts: 1 } // TTL, expireAfterSeconds: 2_592_000

// POI
{ deletedAt: 1 }
{ missionId: 1, deletedAt: 1 }
```

Les TTL MongoDB sont des index en arrière-plan — ils purgent automatiquement sans impacter les performances.

### Options Mongoose (db.ts)

```typescript
await mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
});
```

---

## CORS

Les règles CORS sont centralisées dans `backend/src/corsOrigins.ts` et utilisées à la fois par Fastify (HTTP) et Socket.IO (WebSocket) :

```typescript
export function isAllowedOrigin(origin: string): boolean {
  // FRONTEND_BASE_URL exact match
  // *.netlify.app
  // localhost / 127.0.0.1 en développement
}
```

Un seul endroit à modifier si les origines autorisées changent.

---

## Sécurité

### Points appliqués

- **JWT secrets** : générés cryptographiquement (32 bytes base64), configurés dans Render dashboard
- **CORS partagé** : `corsOrigins.ts` unique pour HTTP et WebSocket — pas de désynchronisation possible
- **Auth sur toutes les routes** : `requireAuth(req)` appelé dans chaque handler (42+ routes vérifiées)
- **Validation des entrées** : coordonnées lat/lng validées, énumérations MongoDB strictes
- **Soft-delete** : les membres supprimés restent en base avec `removedAt` — traçabilité complète
- **Pas de token en query string** : le token WebSocket vient uniquement du header `Authorization` ou `socket.handshake.auth.token`
- **Logs d'erreurs** : tous les blocs catch socket logguent via `console.error` avec contexte

### Keycloak (suspendu)

Les routes OIDC (`/auth/login/oidc`, `/auth/callback`, etc.) sont présentes dans `routes/oidc.ts` mais non enregistrées. Quand Keycloak sera réactivé, il suffit de les réenregistrer dans `index.ts` et d'adapter `plugins/auth.ts`.

---

## Variables d'Environnement

### Backend (`.env` ou Render dashboard)

| Variable | Description |
|---|---|
| `MONGO_URI` | URI de connexion MongoDB |
| `JWT_ACCESS_SECRET` | Secret pour signer les access tokens JWT |
| `JWT_REFRESH_SECRET` | Secret pour signer les refresh tokens JWT |
| `BFF_SESSION_SECRET` | Secret pour les cookies de session BFF |
| `PORT` | Port d'écoute (défaut : 4000) |
| `FRONTEND_BASE_URL` | URL du frontend (ex: `https://app.netlify.app`) |
| `BACKEND_BASE_URL` | URL du backend (ex: `https://api.onrender.com`) |
| `OIDC_ISSUER_URL` | URL du realm Keycloak (suspendu) |
| `OIDC_CLIENT_ID` | Client ID Keycloak (suspendu) |
| `OIDC_CLIENT_SECRET` | Client secret Keycloak (suspendu) |

### Frontend (`.env` Vite ou Netlify dashboard)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | URL de l'API backend |
| `VITE_SOCKET_URL` | URL du serveur WebSocket (souvent identique) |

---

## Déploiement

### Backend (Render)

1. Build : `npm run build` → compile TypeScript dans `dist/`
2. Start : `node ./dist/index.js`
3. Variables d'environnement configurées dans le dashboard Render
4. **Important** : Render endort le service après inactivité (plan gratuit) — le premier appel après inactivité peut être lent

### Frontend (Netlify)

1. Build : `npm run build` → génère `dist/`
2. Publier le dossier `dist/`
3. `netlify.toml` configure les redirections SPA (`/* → /index.html`)

### Rotation des secrets

Si les secrets JWT sont compromis, les changer dans Render dashboard. Tous les tokens existants seront immédiatement invalidés (les utilisateurs doivent se reconnecter).

---

## Développement Local

### Prérequis
- Node.js 18+
- MongoDB local ou cloud

### Backend

```bash
cd backend
npm install
cp .env.example .env  # Remplir les variables
npm run dev           # Lance avec tsx watch (hot-reload)
```

### Frontend

```bash
cd frontend
npm install
npm run dev           # Lance Vite dev server (http://localhost:5173)
npm run typecheck     # Vérification TypeScript
npm run build         # Build production
```

### MongoDB locale

```bash
docker-compose up -d  # Lance MongoDB sur port 27017
```

---

## Patterns de Code

### Patterns Backend à respecter

**Auth en premier dans chaque route :**
```typescript
async handler(req, reply) {
  try {
    requireAuth(req);
  } catch (e: any) {
    return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
  }
  // ... logique
}
```

**Toujours `.lean()` pour les lectures :**
```typescript
const member = await MissionMemberModel.findOne({ missionId, userId }).lean();
```

**Émissions Socket avec optional chaining :**
```typescript
app.io?.to(`mission:${missionId}`).emit('zone:updated', { missionId, zone });
```

**Soft-delete — ne jamais supprimer physiquement un membre :**
```typescript
await MissionMemberModel.updateOne({ _id: member._id }, { $set: { removedAt: new Date() } });
```

### Patterns Frontend à respecter

**MapLibreMap.tsx** est le composant central de la carte (~8000+ lignes). Il gère :
- La carte MapLibre et tous ses layers
- Le GPS local et la géolocalisation
- Le WebSocket de la mission (socket.ts)
- Les états : zones, grilles, pistes, POIs, personCase, notifications

**Keep-alive des pages** : les pages sont cachées avec `className="hidden"` au lieu d'être unmountées. MapLibreMap reste toujours monté — les performances carte sont préservées lors de la navigation.

**Refs pour les closures MapLibre** : les valeurs React utilisées dans les callbacks MapLibre (`onLoad`, `onStyleData`, etc.) doivent être dans des refs, pas des state closures :
```typescript
showActiveVehicleTrackRef.current = showActiveVehicleTrack;
// Utilisé dans onStyleData au lieu de la variable state
```

**Notifications dynamiques (pattern grid/paw) :**
```typescript
// Notification visible quand le contenu est CACHÉ, disparaît quand visible
projectionNotification = !!personCase && !personPanelOpen   // paw
gridNotification = gridHasAssignments && gridViewMode === 'off' // grid
```

**Updates React fonctionnels pour éviter les race conditions :**
```typescript
setTracePoints((prev) => [...prev, newPoint]);  // ✅
setTracePoints([...tracePoints, newPoint]);      // ❌
```

---

## Structure des Routes API

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/auth/login` | Connexion JWT |
| `POST` | `/auth/refresh` | Rafraîchir le token |
| `POST` | `/auth/logout` | Déconnexion |
| `GET` | `/missions` | Liste des missions |
| `POST` | `/missions` | Créer une mission |
| `GET` | `/missions/:id` | Détail d'une mission |
| `PATCH` | `/missions/:id` | Modifier une mission |
| `DELETE` | `/missions/:id` | Supprimer une mission (cascade) |
| `GET` | `/missions/:id/members` | Liste des membres |
| `PATCH` | `/missions/:id/members/:userId` | Modifier un membre |
| `DELETE` | `/missions/:id/members/:userId` | Retirer un membre (ou soi-même) |
| `GET` | `/missions/:id/join-requests` | Demandes de join |
| `POST` | `/missions/:id/join-requests` | Demander à rejoindre |
| `POST` | `/missions/:id/join-requests/:reqId/accept` | Accepter |
| `POST` | `/missions/:id/join-requests/:reqId/decline` | Refuser |
| `GET` | `/missions/:id/zones` | Zones |
| `POST` | `/missions/:id/zones` | Créer une zone |
| `PATCH` | `/missions/:id/zones/:zoneId` | Modifier une zone |
| `DELETE` | `/missions/:id/zones/:zoneId` | Supprimer une zone |
| `POST` | `/missions/:id/zones/:zoneId/assignments` | Assigner un membre |
| `GET` | `/missions/:id/pois` | POIs |
| `POST` | `/missions/:id/pois` | Créer un POI |
| `PATCH` | `/missions/:id/pois/:poiId` | Modifier un POI |
| `DELETE` | `/missions/:id/pois/:poiId` | Supprimer un POI (soft) |
| `GET` | `/missions/:id/person-case` | Fiche personne |
| `PUT` | `/missions/:id/person-case` | Créer/mettre à jour la fiche |
| `DELETE` | `/missions/:id/person-case` | Supprimer la fiche |
| `GET` | `/missions/:id/vehicle-tracks` | Pistes véhicule |
| `POST` | `/missions/:id/vehicle-tracks` | Créer une piste |
| `GET` | `/missions/:id/vehicle-tracks/:id/state` | État d'une piste |
| `GET` | `/missions/:id/contacts` | Contacts |
| `POST` | `/missions/:id/contacts` | Créer un contact |
| `PATCH` | `/missions/:id/contacts/:id` | Modifier un contact |
| `DELETE` | `/missions/:id/contacts/:id` | Supprimer un contact |
| `POST` | `/missions/:id/invites` | Créer une invitation |
| `GET` | `/invites/:token` | Détail d'une invitation |
| `POST` | `/invites/:token/accept` | Accepter une invitation |

### Cas particulier : quitter une mission

Un non-admin peut quitter une mission via `DELETE /missions/:id/members/:userId` (avec son propre userId). La logique `isSelfLeave` distingue :
- **Soi-même** : toujours autorisé sauf si dernier admin avec d'autres membres
- **Autre membre** : réservé aux admins

---

## Troubleshooting

### Positions GPS ne s'affichent pas

1. Vérifier la connexion WebSocket (onglet Network → WS du navigateur)
2. L'utilisateur est-il bien membre de la mission ?
3. Le cache socket est-il invalidé ? (attendre 30s ou forcer un rechargement)

### Disque probabiliste (piste à pieds) absent sur la carte

Le disque de probabilité n'est visible que quand le **panneau paw est ouvert**. Si le panneau est fermé, la notification rouge apparaît sur l'icône paw. Cliquer sur paw ouvre le panneau et affiche le disque.

### Badge settings reste à 0 même avec une piste et une grille actives

Vérifier les deux conditions simultanément :
- `personCase` doit exister ET le panneau paw doit être fermé
- `gridHasAssignments` doit être true ET `gridViewMode` doit être `'off'`

Si le panneau paw est ouvert OU si le mode grille est actif, la contribution correspondante est 0.

### Piste véhicule (polygone rouge) disparaît après changement de fond de carte

Géré par l'événement `styledata` de MapLibre qui re-injecte les données via `vehicleTrackGeojsonByIdRef`. Si cela persiste, vérifier que `styleVersion` est bien dans les deps des effects de rendu.

### Membre viré continue d'envoyer des positions

Vérifier que le cache socket est bien invalidé après un kick. Le cache a un TTL de 30 secondes — au pire, les positions passent pendant 30s avant que le membership soit re-vérifié.

### Un admin ne peut pas quitter une mission

Protection : le **dernier admin** ne peut pas partir s'il reste d'autres membres. Il faut d'abord promouvoir un autre membre en admin, ou supprimer tous les membres.

### Demandes de join réapparaissent après un kick

Vérifier la logique d'auto-réparation dans `GET /join-requests` : elle ne doit pas réparer si `MissionMember.removedAt` est non-null.

---

## Bonnes Pratiques

- **Ne pas modifier les schémas Mongoose sans réfléchir aux migrations** — les documents existants en base ne seront pas mis à jour automatiquement
- **Chaque nouveauté dans le schéma doit être `required: false`** pour rester compatible avec les documents existants
- **Les TTL indexes MongoDB** s'appliquent en arrière-plan sans bloquer la prod — safe à ajouter sur un système live
- **Pas de `console.log` dans les handlers socket** — utiliser `console.error` uniquement pour les erreurs
- **ConfirmDialog** utilise un `React.createPortal` vers `document.body` — nécessaire pour échapper aux conteneurs avec `overflow-hidden`
- **Les couleurs de carte** (palettes zones, contacts, POIs) ne contiennent pas le teal `#14b8a6` — retiré pour lisibilité sur fond de carte
