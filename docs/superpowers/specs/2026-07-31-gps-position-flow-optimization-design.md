# Optimisation du flux de positions GPS temps réel (bande passante + CPU)

Date : 2026-07-31
Statut : approuvé

## Contexte

Chaque membre d'une mission envoie sa position GPS via WebSocket. Le serveur relaie
chaque position reçue à tous les autres membres connectés de la même mission
(room `mission:{missionId}`). Hébergement actuel temporaire (Render, offre gratuite,
veille après 15 min d'inactivité, ~1 min de redémarrage) — le passage sur les
serveurs de l'unité est prévu mais pas encore en place.

Objectif : réduire la bande passante et la charge CPU du flux de positions
d'environ 70%, et prévenir l'utilisateur du délai de démarrage au lancement.

## Constats de code (avant conception, à ne pas re-découvrir en implémentant)

- **Il n'existe aucun throttle applicatif à 2s côté client.** `watchPosition` émet
  `position:update` au rythme du navigateur/OS, sans limitation. Il y a **deux**
  points d'émission distincts, tous deux à modifier :
  - `frontend/src/hooks/useMissionGeolocation.ts` (watcher hors page carte)
  - `frontend/src/components/MapLibreMap.tsx` (watcher propre, actif sur la page carte)
- Le payload `position:update` construit côté serveur (`backend/src/socket.ts`,
  variable `msg`) est déjà minimal : `missionId, userId, lng, lat, speed, heading,
  accuracy, t` — pas de couleur/nom renvoyés à chaque message.
- `TRACE_THROTTLE_MS = 2000` existe déjà côté serveur mais throttle uniquement
  l'écriture dans `TraceModel` — pas le broadcast, pas l'upsert `PositionCurrentModel`
  (fait à chaque message individuellement).
- `position:bulk` (flush offline) est déjà batché côté écriture Mongo
  (`insertMany`) — non concerné par ce travail, seulement à ne pas casser.
- `ConfirmDialog.tsx` ferme au clic sur l'overlay (`onClick={onCancel}`) — la
  modale de démarrage ne doit **pas** reprendre ce comportement.

## Découpage en lots

Les lots sont groupés par fichiers qui se recouvrent, pas par tâche numérotée,
pour éviter que deux agents modifient les mêmes lignes en parallèle.

### Lot A — Filtrage GPS client (bande passante ~45%+25%)

Fichiers : `frontend/src/hooks/useMissionGeolocation.ts`,
`frontend/src/components/MapLibreMap.tsx` (watcher GPS uniquement, pas le listener).

- Avant d'émettre `position:update`, comparer à la dernière position **envoyée**
  (pas juste reçue) : n'émettre que si distance haversine ≥ `SIGNIFICANT_MOVE_METERS`
  (8m, constante nommée) OU ≥ 30s écoulées depuis le dernier envoi (heartbeat).
- Arrondir `lat`/`lng` à 5 décimales avant l'émission.
- Ne touche pas `position:bulk` (flush offline, chemin différent, déjà correct).
- Test manuel : un membre immobile ne doit générer qu'un message toutes les ~30s.

### Lot B — Batching temps réel serveur + réception client (bande passante ~10%, CPU important)

Fichiers : `backend/src/socket.ts`, `backend/src/models/positionCurrent.ts` /
`backend/src/models/trace.ts` (écriture bulk), `frontend/src/components/MapLibreMap.tsx`
(listener de réception uniquement).

- Serveur : à la réception de `position:update`, stocker dans
  `Map<missionId, Map<userId, payload>>` au lieu d'émettre immédiatement.
- Un tick par mission active (1-2s) : si le buffer n'est pas vide, `bulkWrite`
  upsert groupé sur `PositionCurrentModel`, `insertMany` groupé sur `TraceModel`
  (en respectant le throttle par-utilisateur existant `TRACE_THROTTLE_MS`), puis
  un seul `io.to(mission).emit('position:batch', [...])`.
- **Bascule directe** : `position:update` disparaît du broadcast serveur→client
  (le serveur n'émet plus que `position:batch`), le client n'écoute plus que
  `position:batch`. Pas de période de transition (monorepo, front/back toujours
  déployés ensemble) — décision utilisateur explicite.
- Cleanup : le timer d'une mission s'arrête et la map se vide quand la room
  `mission:{id}` n'a plus de socket connecté (éviter les timers orphelins).
- `position:bulk` (réception offline) : chemin non touché.
- Commentaire de code : perte de données possible sur crash serveur entre deux
  ticks (fenêtre 1-2s), acceptée explicitement, pas de queue persistante.

### Lot C — Modale d'avertissement hébergement (frontend, indépendant)

Fichiers : nouveau `frontend/src/components/StartupNoticeModal.tsx`, `frontend/src/App.tsx`.

- Portail vers `document.body` (même pattern que `ConfirmDialog.tsx`) mais
  **sans** fermeture au clic sur l'overlay ni sur Échap.
- Affichée à chaque chargement (`useState(true)`, pas de mémorisation localStorage).
- Titre "Version limitée", corps expliquant le délai de redémarrage Render,
  bouton "J'ai compris" qui la ferme.
- Commentaire `// TODO: retirer cette modale une fois le backend basculé sur les
  serveurs de l'unité`.
- Montée au niveau racine de `App.tsx`, avant/au-dessus du routing, pour bloquer
  l'interaction avant même le chargement des données mission.

### Lot D — Parser msgpack (bande passante ~18%, isolé, en dernier)

Fichiers : `backend/src/socket.ts` (options `Server`), `frontend/src/lib/socket.ts`
(options `io(...)`).

- `socket.io-msgpack-parser` des deux côtés, **commit séparé**, déployé seul
  **après** validation des lots A/B/C en prod — le point le plus cassant si
  désynchronisé (un seul côté mis à jour = incompatibilité totale).
- Vérifier que ça n'impacte pas les autres événements Socket.IO existants
  (zones, POI, notifications, vehicle-track) — le changement de parser
  s'applique à tous les messages.

## Hors scope (décision explicite)

**Optimisation de `computeVehicleRoadGraph` / `vehicleTrackScheduler.ts`** :
proposée dans une demande séparée, mais `computeVehicleRoadGraph` n'est appelée
nulle part actuellement (grep confirmé) — le scheduler route les pistes
`algorithm === 'road_graph'` vers `computeVehicleTomtomReachableRange` à la
place (commentaire de code : "Legacy 'tomtom_tiles' grid mode is disabled").
Optimiser du code mort n'a aucun impact mesurable. Décision utilisateur :
laissé de côté pour l'instant, à reprendre si/quand ce chemin est rebranché.

## Attribution des agents

| Lot | Agent recommandé | Raison |
|---|---|---|
| A | sonnet (défaut) | Filtrage client, deux fichiers, logique isolée et testable |
| B | opus | Le plus risqué : timers par mission, cleanup mémoire, contrat d'événement serveur/client à faire correspondre exactement, écritures Mongo groupées |
| C | haiku | UI simple, mécanique, spec complète et sans ambiguïté |
| D | sonnet | Petit diff mais synchronisation critique des deux côtés, testée en dev avant tout déploiement |

Séquencement : A et C en parallèle (fichiers indépendants). B démarre après que
A soit mergé — les deux touchent `MapLibreMap.tsx` (sections différentes,
watcher vs listener) et merger B sur une base à jour évite tout conflit, même
mineur. D en dernier, seul, après validation manuelle de A+B+C.

## Validation

Vérifiable directement par l'agent/moi (pas de risque, pas de dépendance à une
session multi-utilisateur réelle) :
- Lot C : lancer le serveur dev + navigateur, vérifier que la modale bloque
  l'interaction et ne se ferme qu'au clic sur le bouton.
- Lecture de diff pour confirmer le respect des patterns obligatoires
  (`requireAuth`, `.lean()`, soft-delete, `app.io?.`, updates fonctionnels React,
  pas de `required: true` ajouté sans migration).

Nécessite une vérification manuelle en conditions réelles (prompt Claude Cowork
fourni séparément, pas tenté par l'agent) :
- Lot A+B : un membre immobile ne génère qu'un message ~30s ; un seul
  `position:batch` par tick visible dans Network → WS, pas un `position:update`
  par membre.
- Lot D : synchronisation dev des deux côtés du parser msgpack avant tout
  déploiement prod.

## Non-objectifs / contraintes de non-régression

- Ne jamais rendre un champ de schéma Mongoose `required: true` sans plan de
  migration.
- `requireAuth`, `.lean()`, soft-delete, `app.io?.`, updates fonctionnels React :
  patterns existants à préserver partout où ils s'appliquent déjà.
- `position:bulk` doit continuer à fonctionner sans régression sur toute la
  durée du travail (lots A, B, D le traversent ou l'entourent sans le modifier).
