# GeoGN - Guide du Développeur

## Qu'est-ce que GeoGN ?

GeoGN est une application web de géolocalisation collaborative. Imaginez une application où des équipes (secours, chantiers, patrouilles...) peuvent voir en temps réel où se trouvent leurs membres sur une carte interactive, avec l'historique de leurs déplacements (traces GPS).

**En pratique :**
- Les membres d'une mission partagent leurs positions GPS
- Chaque membre a une couleur de trace unique sur la carte
- Les admins peuvent gérer qui participe (invitations, demandes de join)
- Les positions sont mises à jour en temps réel via WebSocket
- Les traces GPS sont conservées pendant une durée configurable

## Architecture du Projet

GeoGN est un **monorepo** (un seul dépôt git avec backend et frontend) :

```
GeoGN/
├── backend/          # Serveur API + WebSocket
│   ├── src/
│   │   ├── models/   # Définitions des données MongoDB
│   │   ├── routes/   # Routes API REST
│   │   ├── plugins/  # Plugins Fastify (authentification, etc.)
│   │   └── socket.ts # Serveur WebSocket (Socket.IO)
│   └── package.json
├── frontend/         # Application web React
│   ├── src/
│   │   ├── components/  # Composants réutilisables (carte, formulaires...)
│   │   ├── pages/       # Pages de l'application (missions, map, contacts...)
│   │   ├── contexts/    # Contextes React (auth, mission...)
│   │   ├── hooks/       # Hooks personnalisés (géolocalisation...)
│   │   └── lib/         # Utilitaires (socket, API...)
│   └── package.json
└── docker-compose.yml  # Configuration Docker (MongoDB)
```

## Technologies Utilisées

### Côté Backend (Serveur)
- **Fastify** : Framework web rapide pour l'API REST
- **MongoDB** : Base de données NoSQL pour stocker les positions et missions
- **Mongoose** : ODM pour interagir avec MongoDB
- **Socket.IO** : WebSocket pour les mises à jour en temps réel
- **Keycloak/OIDC** : Authentification des utilisateurs
- **TypeScript** : JavaScript avec types pour plus de sécurité

### Côté Frontend (Application Web)
- **React 18** : Framework JavaScript pour l'interface
- **React Router v6** : Gestion de la navigation
- **MapLibreGL** : Bibliothèque de cartes interactive (alternative open-source à Mapbox)
- **Socket.IO-client** : Client WebSocket pour les mises à jour temps réel
- **Vite** : Outil de build ultra-rapide pour le développement
- **TypeScript** : JavaScript avec types

## Concepts Clés à Comprendre

### 1. Missions
Une mission est comme un "groupe" ou un "projet". Par exemple : "Patrouille Zone Nord", "Chantier Site A", "Opération Secours".

**Ce qu'elle contient :**
- Un nom (ex: "Patrouille Zone Nord")
- Un état : `draft` (brouillon), `active` (en cours), `closed` (terminée)
- Un style de carte (fond de carte MapLibre)
- Une durée de rétention des traces (combien de temps on garde les traces GPS)

### 2. Membres d'une Mission
Les membres sont les utilisateurs qui participent à une mission.

**Rôles :**
- **admin** : Peut tout gérer (ajouter/supprimer membres, changer les rôles, accepter les demandes)
- **member** : Peut voir les positions et traces des autres
- **viewer** : Lecture seule (ne peut pas modifier)

**Chaque membre a :**
- Une couleur de trace unique (ex: rouge, bleu, vert...)
- Un état actif/inactif
- Une date de rejoindre
- Une date de suppression (soft-delete = on ne supprime vraiment jamais, on marque juste "supprimé")

### 3. Positions GPS
Il y a **deux types** de stockage des positions :

**PositionCurrent (position courante)**
- C'est la position actuelle de chaque membre
- Un seul point par membre (le plus récent)
- Contient : longitude, latitude, vitesse, direction, précision, timestamp
- Exemple : "Jean est actuellement à [lat, lng]"

**Trace (historique des positions)**
- C'est l'historique complet pour dessiner la trace sur la carte
- Un point par position reçue (avec throttle)
- Contient : longitude, latitude, couleur, timestamp, date d'expiration
- Exemple : "Jean a passé par [lat1, lng1] → [lat2, lng2] → ..."
- **Important** : Les traces ont une date d'expiration (TTL) - MongoDB les supprime automatiquement après cette date

### 4. Invitations
Les admins peuvent inviter directement quelqu'un via un token (comme un lien magique).

**États :**
- `pending` : Invitation envoyée, pas encore répondue
- `accepted` : Invitation acceptée
- `declined` : Invitation refusée
- `revoked` : Invitation annulée par l'admin

### 5. Demandes de Join (Join Requests)
Les utilisateurs peuvent demander à rejoindre une mission eux-mêmes. Les admins doivent accepter ou refuser.

**États :**
- `pending` : En attente de réponse admin
- `accepted` : Acceptée par un admin
- `declined` : Refusée par un admin

## Comment Fonctionne le Temps Réel (WebSocket)

### Les "Rooms" Socket.IO
Socket.IO utilise des "rooms" pour envoyer des messages à des groupes spécifiques :

- **`mission:{missionId}`** : Tous les membres connectés d'une mission reçoivent les messages
  - Exemple : `mission:12345` = tous les membres de la mission 12345
- **`user:{userId}`** : Un utilisateur spécifique pour les notifications personnelles
  - Exemple : `user:67890` = notifications pour l'utilisateur 67890

### Messages Client → Serveur

**`mission:join`** - "Je rejoins cette mission"
- Quand : Au chargement d'une page de mission
- Payload : `{ missionId, retentionSeconds? }`
- Ce que fait le serveur : Vérifie que tu es membre, t'ajoute à la room, t'envoie les positions actuelles
- Pourquoi : Pour recevoir les mises à jour en temps réel

**`position:update`** - "Voici ma position GPS"
- Quand : Chaque seconde (environ) quand le GPS bouge
- Payload : `{ lng, lat, speed?, heading?, accuracy?, t }`
- Ce que fait le serveur : Sauvegarde la position, envoie à tout le monde
- **Important** : Throttle = 1 point toutes les 2 secondes en base de données pour ne pas la surcharger

**`position:bulk`** - "Voici toutes mes positions accumulées pendant que j'étais déconnecté"
- Quand : Quand le socket se reconnecte après une déconnexion
- Payload : `{ points: [...] }` (max 200 points)
- Ce que fait le serveur : Sauvegarde TOUTES les positions (sans throttle), envoie à tout le monde
- Pourquoi : Pour ne pas perdre de données quand tu étais offline

### Messages Serveur → Client

**`mission:joined`** - "Tu as bien rejoint la mission"
- Confirmation que le `mission:join` a réussi

**`mission:snapshot`** - "Voici toutes les positions et traces actuelles"
- Quand : Après un `mission:join` ou demande explicite
- Payload : `{ positions: [...], traces: {...} }`
- Pourquoi : Pour restaurer l'état de la carte sans attendre les positions une par une

**`position:update`** - "Voici la position de quelqu'un"
- Quand : Quand un membre envoie sa position
- Broadcast : À toute la room mission
- Pourquoi : Pour mettre à jour la carte en temps réel

**`position:bulk`** - "Voici les positions offline de quelqu'un"
- Quand : Quand quelqu'un se reconnecte
- Broadcast : À toute la room mission
- Pourquoi : Pour rattraper les positions manquantes

**`position:clear`** - "Nettoie les positions de ce membre"
- Quand : Quand un membre est supprimé d'une mission
- Payload : `{ missionId, userId }`
- Pourquoi : Pour retirer les positions/traces de la carte

**`member:updated`** - "Les infos d'un membre ont changé"
- Quand : Quand un admin change le rôle ou la couleur d'un membre
- Payload : `{ missionId, member: {...} }`
- Pourquoi : Pour mettre à jour l'affichage (couleur de trace, badge rôle...)

**`join-request:created`** - "Quelqu'un a demandé à rejoindre"
- Quand : Quand un utilisateur fait une demande de join
- Payload : `{ missionId, request: {...} }`
- Envoyé à : Tous les admins de la mission (via room `user:{adminId}`)
- Pourquoi : Pour que les admins voient la demande en temps réel sans refresh

**`join-request:resolved`** - "Une demande a été acceptée ou refusée"
- Quand : Quand un admin accepte ou refuse une demande
- Payload : `{ missionId, request: {...} }`
- Envoyé à : L'auteur de la demande + tous les admins
- Pourquoi : Pour mettre à jour les listes en temps réel

**`mission:deleted`** - "Cette mission a été supprimée"
- Quand : Quand un admin supprime une mission
- Payload : `{ missionId }`
- Envoyé à : Tous les membres connectés
- Pourquoi : Pour rediriger les utilisateurs vers la liste des missions

## Le Cache Socket (Optimisation)

### Pourquoi ?
Chaque fois qu'un membre envoie sa position, le serveur doit vérifier s'il est bien membre de la mission. Sans cache, ça ferait une requête MongoDB à chaque position (plusieurs par seconde par membre). Avec cache, on évite ces requêtes.

### Comment ça marche ?
Le serveur stocke dans la mémoire du socket :
```typescript
cached: {
  memberColor: string;         // La couleur de trace du membre
  retentionSeconds: number;    // La durée de rétention des traces
  checkedAt: number;          // Quand on a vérifié la dernière fois
}
```

**Durée de vie du cache :** 30 secondes

### Quand est-il peuplé ?
- Quand un socket fait `mission:join` (après vérification membership)

### Quand est-il utilisé ?
- Dans `position:update` pour éviter de refaire la query MongoDB

### Quand est-il invalidé (remis à zéro) ?
- Quand un admin change le rôle ou la couleur d'un membre
- Quand un admin supprime un membre (kick)
- Après 30 secondes (TTL automatique)

## Flux Complet de Géolocalisation

### Côté Client (Application Web)

**Sur les pages annexes (zones, POIs, contacts) - PAS la carte**
- Le hook `useMissionGeolocation` gère le GPS
- Il est DÉSACTIVÉ quand on est sur la carte (MapLibreMap gère son propre GPS)
- Il envoie `position:update` en temps réel
- Si le socket est déconnecté, il empile les positions dans localStorage
- À la reconnexion, il flush tout via `position:bulk`

**Sur la carte (MapLibreMap)**
- MapLibreMap gère son propre watcher GPS (plus complexe)
- Il envoie `position:update` en temps réel
- Il gère les snapshots (restauration de l'état)
- Il fait un merge intelligent : traces locales + snapshot = meilleure résolution

### Côté Serveur

**Traitement d'une position individuelle (`position:update`)**
1. Vérifie que lat/lng sont valides
2. Vérifie que l'expéditeur est membre de la mission (avec cache si disponible)
3. Met à jour `PositionCurrent` (la position courante du membre)
4. Throttle l'insertion en `Trace` (1 point toutes les 2 secondes)
5. Broadcast la position à toute la room mission

**Traitement d'un flush offline (`position:bulk`)**
1. Vérifie lat/lng pour chaque point
2. Vérifie membership (avec cache)
3. **SANS throttle** : insère TOUS les points en `Trace` (pour fidélité)
4. Met à jour `PositionCurrent` avec le dernier point
5. Broadcast tous les points à toute la room mission

**Envoi d'un snapshot (`emitMissionSnapshot`)**
1. Récupère toutes les `PositionCurrent` de la mission
2. Récupère toutes les `Trace` dans la fenêtre de rétention
3. Groupe par userId
4. Envoie `mission:snapshot` au socket demandeur

## Gestion des Déconnexions/Reconnexions

### Côté Frontend

**Socket.ts (gestionnaire de connexion WebSocket)**
- Singleton : une seule connexion pour toute l'application
- Reconnexion automatique si le token expire
- Appelle `refreshTokens()` directement (pas d'appel API)
- Options de reconnexion par défaut

**useMissionGeolocation (hook GPS)**
- Au chargement : restaure les positions empilées dans localStorage
- Persistance debouncée (2 secondes) pour ne pas bloquer l'application
- À la reconnexion : flush automatique des positions accumulées
- Quand l'app redevient active (focus/visibility) : envoie une position immédiate

**MapLibreMap (composant carte)**
- Snapshot automatique à la reconnexion
- Merge intelligent : traces locales + traces du snapshot
- Persistance debouncée (1500ms) pour localStorage
- Gère une queue offline `pendingBulkRef`

### Côté Backend

**Socket.ts (serveur WebSocket)**
- Crée automatiquement la room `user:{userId}` à la connexion
- Peuple le cache socket lors de `mission:join`
- TTL du cache : 30 secondes

## Notifications en Temps Réel

### Cycle de Vie d'une Demande de Join

**1. Création de la demande**
- Utilisateur POST `/missions/:id/join-requests`
- Serveur émet `join-request:created` aux admins (via room `user:{adminId}`)
- Frontend MissionContactsPage écoute et met à jour l'UI en temps réel
- Les admins voient immédiatement la nouvelle demande sans refresh

**2. Acceptation ou Refus**
- Admin POST `/missions/:id/join-requests/:requestId/accept` ou `/decline`
- Serveur émet `join-request:resolved` à l'auteur ET aux admins
- Frontend met à jour les listes en temps réel
- L'auteur voit son statut changer immédiatement

**3. Auto-réparation (GET join-requests)**
- Quand un admin liste les demandes (`GET /missions/:id/join-requests`)
- Si une demande est `accepted` mais AUCUN `MissionMember` n'existe (crash accept), repasse en `pending`
- Si un `MissionMember` existe avec `removedAt` (admin a viré le membre), NE répare PAS
- Pourquoi ? Pour éviter que les membres virés fassent réapparaître leur demande

### Gestion des Membres

**Mise à jour (rôle, couleur)**
- Admin PATCH `/missions/:id/members/:userId`
- Serveur émet `member:updated` à toute la room mission
- Invalide le cache socket du membre
- Frontend met à jour en temps réel (nouvelle couleur de trace, nouveau rôle)

**Suppression (kick)**
- Admin DELETE `/missions/:id/members/:userId`
- Serveur émet `member:updated` ET `position:clear` à toute la room mission
- Invalide le cache socket du membre
- Frontend retire les positions/traces en temps réel
- Le membre ne peut plus envoyer de positions (vérification membership)

### Suppression d'une Mission

**Cascade DELETE**
- Admin DELETE `/missions/:id`
- Serveur émet `mission:deleted` AVANT la suppression (pour prévenir les clients)
- Supprime en cascade 11 collections liées :
  - MissionMember, MissionInvite, MissionJoinRequest
  - Zone, Position, PositionCurrent
  - Trace, Poi, PersonCase
  - VehicleTrack, HuntIsochrone
- Frontend MissionLayout écoute l'événement et redirige vers `/`

## Optimisations de Performance

### Côté Backend

**Cache Socket**
- Réduit les requêtes MongoDB dans `position:update`
- TTL 30 secondes pour rester à jour
- Invalidation automatique sur changements de rôle/couleur/kick

**Throttle des positions**
- En temps réel : 1 point toutes les 2 secondes en base de données
- Réduit le volume de données stockées
- **Exception** : `position:bulk` (offline) - SANS throttle pour fidélité

### Côté Frontend

**Debounce LocalStorage**
- Persistance debouncée à 1500ms
- Évite les blocages du thread principal pendant le tracking
- Appliqué à `tracePoints` (traces locales) et `otherTracesRef` (traces des autres)

**Merge Snapshot/Live**
- Merge intelligent : traces du snapshot + traces reçues en live
- Conservation de la résolution locale (1Hz vs 0.5Hz serveur)
- Récupération des points anciens du snapshot si pertinents

**Ignore Echo Bulk**
- Les echos de `position:bulk` pour soi-même sont ignorés
- Évite les doublons dans la trace personnelle
- Les `position:update` restent appliqués (cohérence)

**Single mission:join**
- Hook `useMissionGeolocation` désactivé sur la carte
- Évite le double `mission:join` et double snapshot
- MapLibreMap gère le socket quand on est sur la carte

## Sécurité

### Authentification
- Keycloak/OIDC pour l'authentification des utilisateurs
- JWT tokens avec refresh automatique
- Middleware `requireAuth(req)` sur toutes les routes protégées

### Authorization
- Vérification du membership pour CHAQUE opération
- Rôles : admin, member, viewer
- Seuls les admins peuvent gérer les membres

### Validation
- Validation des coordonnées lat/lng dans les handlers socket
- Filtre sur `removedAt: null` pour ne considérer que les membres actifs
- Auto-réparation des demandes "accepted" sans membre correspondant

## Guide de Développement Rapide

### Backend

```bash
cd backend
npm install              # Installer les dépendances
npm run dev             # Lancer en mode développement
npm run build           # Compiler TypeScript
```

### Frontend

```bash
cd frontend
npm install              # Installer les dépendances
npm run dev             # Lancer en mode développement (Vite)
npm run build           # Build pour production
npm run typecheck       # Vérifier les types TypeScript
```

### Docker (MongoDB locale)

```bash
docker-compose up       # Lancer backend + MongoDB
```

## Structure de la Base de Données

### Collections Principales

**Mission**
- Stocke les missions (nom, état, style de carte...)

**MissionMember**
- Stocke les membres des missions
- Soft-delete via `removedAt` (on ne supprime vraiment jamais)
- Contient : rôle, couleur, état actif, dates

**MissionInvite**
- Stocke les invitations tokenisées
- Permet d'ajouter directement un membre via un lien

**MissionJoinRequest**
- Stocke les demandes de join en attente
- Contient : état, demandeur, date de création

**PositionCurrent**
- Position courante de chaque membre
- Un seul point par membre (le plus récent)
- Contient : coordonnées, vitesse, direction, précision

**Trace**
- Historique des positions pour le tracé
- Plusieurs points par membre
- TTL automatique via `expiresAt` (MongoDB supprime automatiquement après expiration)

### Indexes Importants

- `PositionCurrent` : `{ missionId: 1, userId: 1 }` (unique - un seul point par membre)
- `Trace` : `{ missionId: 1, userId: 1, createdAt: -1 }` (pour les requêtes par mission/user)
- `Trace` : `{ expiresAt: 1 }` (TTL - suppression automatique)

## Déploiement

### Backend
- Build TypeScript → dossier `dist/`
- Node.js avec modules ESM
- Variables d'environnement requises :
  - `MONGODB_URI` : URL de connexion MongoDB
  - `KEYCLOAK_URL` : URL du serveur Keycloak
  - `KEYCLOAK_REALM` : Realm Keycloak
  - `KEYCLOAK_CLIENT_ID` : ID client Keycloak

### Frontend
- Build Vite → dossier `dist/`
- Fichiers statiques (HTML, CSS, JS)
- Peut être servi par Nginx, Apache, Netlify...
- Variable d'environnement requise :
  - `VITE_API_BASE_URL` : URL de l'API backend

## Maintenance et Monitoring

### Logs
- **Backend** : Pino logger avec rotation automatique des fichiers
- **Frontend** : Console du navigateur (DevTools)

### Points de Monitoring
- Nombre de connexions Socket.IO actives
- Performance localStorage (debounce, taille des données)
- Efficacité du cache socket (hit rate)
- Volume des requêtes `position:update` vs `position:bulk`

## Bonnes Pratiques pour les Développeurs

### Patterns à Respecter

**Routes Fastify (Backend)**
```typescript
try {
  requireAuth(req);  // Vérifie l'authentification
} catch (e: any) {
  return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
}
```


**Lectures MongoDB (Backend)**
- Toujours utiliser `.lean()` pour éviter les surcharges Mongoose
```typescript
const member = await MissionMemberModel.findOne({ ... }).lean();
```

**Émissions Socket (Backend)**
- Utiliser `app.io?.to(...).emit(...)` avec optional chaining
```typescript
app.io?.to(`mission:${missionId}`).emit('event', payload);
```

**Logs (Backend)**
- Utiliser `req.log` (pas `console.log`)
```typescript
req.log.info('User joined mission', { missionId, userId });
```

**Mises à jour d'état React (Frontend)**
- Utiliser les updates fonctionnels pour éviter les race conditions
```typescript
setTracePoints((prev) => [...prev, newPoint]);  // ✅ Correct
setTracePoints([...tracePoints, newPoint]);      // ❌ Risque de race condition
```

### Contraintes Absolues

⚠️ **NE JAMAIS modifier :**
- Les schémas Mongoose (`backend/src/models/*.ts`)
- Le code Keycloak/OIDC
- La connexion MongoDB

⚠️ **Éviter :**
- Ajouter de nouvelles dépendances externes
- Refactor massif sans justification
- Modifications non chirurgicales

## Troubleshooting (Problèmes Courants)

### Problème : Les positions ne s'affichent pas en temps réel
**Vérifier :**
1. Socket.IO est-il connecté ? (onglet Network/WS du navigateur)
2. L'utilisateur est-il bien membre de la mission ?
3. Le cache socket est-il invalide ? (attendre 30s ou changer rôle/couleur)

### Problème : Les traces GPS sont doublées
**Cause probable :** Echo de `position:bulk` non ignoré
**Solution :** Vérifier que `applyRemotePosition` a bien le paramètre `opts?.fromBulk`

### Problème : Les traces ont une mauvaise résolution après reconnexion
**Cause probable :** Snapshot écrase les traces locales
**Solution :** Vérifier que le merge snapshot/live est actif dans `onSnapshot`

### Problème : Un membre viré continue d'envoyer des positions
**Cause probable :** Cache socket non invalidé
**Solution :** Vérifier que l'invalidation est bien appelée dans la route DELETE members

### Problème : Les demandes de join réapparaissent après un kick
**Cause probable :** Auto-réparation incorrecte dans GET join-requests
**Solution :** Vérifier que le filtre `removedAt: null` a été retiré du findOne

## Ressources Utiles

- **Documentation Socket.IO** : https://socket.io/docs/
- **Documentation Fastify** : https://www.fastify.io/docs/latest/
- **Documentation Mongoose** : https://mongoosejs.com/docs/
- **Documentation MapLibreGL** : https://maplibre.org/maplibre-gl-js-docs/
- **Documentation React** : https://react.dev/

## Support

Pour toute question technique ou problème, consulter ce README d'abord. Si le problème persiste, contacter l'équipe de développement avec :
- La version du code
- Les logs d'erreur (backend et frontend)
- Les étapes pour reproduire le problème
