# Audit visuel GeoGN — Design Spec

**Date :** 2026-06-30  
**Statut :** Approuvé  
**Approche retenue :** B — Primitives partagées  
**Direction visuelle :** Clean / iOS-like premium (fond clair, typographie renforcée, états elevés)

---

## Contexte

GeoGN est une PWA React + TypeScript + Tailwind CSS de géolocalisation et coordination de missions. L'interface présente une double identité visuelle : la page de connexion est sombre et léchée, l'intérieur de l'app est clair mais utilitaire/générique. L'objectif est d'élever le rendu intérieur au niveau iOS-like premium sans toucher à la logique métier.

**Contraintes :**
- Ne pas modifier la logique (state, API calls, socket events)
- Ne pas committer/pousser sans accord explicite de l'utilisateur

---

## Section 1 — Primitives UI partagées

Dossier : `frontend/src/components/ui/`

### `Skeleton.tsx`
Bloc shimmer générique. Animation `@keyframes shimmer` qui fait glisser un gradient de gauche à droite sur un fond `bg-gray-200`. Props : `className` pour taille et forme.

```
bg-gray-200 rounded-xl overflow-hidden
::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent); animation: shimmer 1.4s infinite; }
```

### `SkeletonCard.tsx`
Squelette d'une carte de liste. Compose plusieurs `<Skeleton />` pour simuler : ligne large (titre), ligne courte (sous-titre), bloc bouton optionnel à droite. Accepte un prop `count` pour répéter N fois.

### `EmptyState.tsx`
État vide centré. Props : `icon` (composant Lucide), `title` (string), `subtitle` (string optionnel).  
Rendu : icône 32px en `text-gray-300`, titre `text-sm font-medium text-gray-500`, sous-titre `text-xs text-gray-400`. Padding vertical généreux (`py-10`).

### `PageHeading.tsx`
Titre de page renforcé. Props : `title`, `subtitle` (optionnel), `action` (nœud React optionnel aligné à droite).  
Typographie : `text-2xl font-bold tracking-tight text-gray-900`. Sous-titre : `text-sm text-gray-500 mt-0.5`.

---

## Section 2 — Animations & transitions

### Boutons (toutes pages)
Ajouter sur tous les éléments cliquables (boutons, liens nav) :
```
active:scale-[0.97] transition-transform duration-100
focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
disabled:opacity-40 disabled:pointer-events-none
```
Remplacer `disabled:opacity-50` existant par `disabled:opacity-40 disabled:pointer-events-none`.

### Transitions de routes — Framer Motion
Dépendance à ajouter : `framer-motion`.

Chaque route envelopée dans un `<motion.div>` :
```tsx
<motion.div
  initial={{ opacity: 0, x: 16 }}
  animate={{ opacity: 1, x: 0 }}
  exit={{ opacity: 0, x: -16 }}
  transition={{ duration: 0.18, ease: 'easeOut' }}
>
```
`<AnimatePresence mode="wait" />` autour des outlets dans `AppShell` et `MissionLayout`.

---

## Section 3 — Keep-alive routing

### Principe
Remplacer `<Outlet />` par un composant `<KeepAliveOutlet />` qui :
1. Maintient tous les composants enfants montés simultanément dans le DOM
2. Toggle `hidden` (Tailwind) sur les inactifs plutôt que de les démonter
3. Préserve le state local, les socket listeners et les positions de scroll de chaque page

### Composant `KeepAliveOutlet.tsx`
```tsx
// Utilise useLocation + une config de routes déclarée statiquement
// Rend chaque route enfant avec className={isActive ? '' : 'hidden'}
// Mémorise les routes déjà visitées pour ne pas rendre inutilement au premier montage
```

### Périmètre
| Shell | Routes keep-alive |
|---|---|
| `AppShell` | `/home` · `/contacts` · `/profile` |
| `MissionLayout` | `map` · `zones` · `pois` · `contacts` |

### Point d'attention — MapLibre
Quand le conteneur map passe de `hidden` à visible, appeler `map.resize()` pour recalculer les dimensions du canvas WebGL. Implémenté via un `ResizeObserver` ou un event custom `geogn:map:visible` dispatché par `KeepAliveOutlet`.

---

## Section 4 — Corrections visuelles page par page

### Corrections globales
- **ProfilePage** : `rounded-lg` → `rounded-2xl` sur toutes les cartes (incohérence actuelle)
- Tous les boutons : états hover/active/focus/disabled homogénéisés (voir Section 2)

### CurrentMissionPage
- Titre "GeoGN" → `<PageHeading title="GeoGN" />`
- "Chargement…" liste missions → `<SkeletonCard count={2} />`
- "Aucune mission." → `<EmptyState icon={Target} title="Aucune mission" subtitle="Crée ou rejoins une mission pour commencer." />`

### MissionsPage
- `<PageHeading title="Missions" action={bouton Actualiser existant déplacé en prop} />`
- Chargement → `<SkeletonCard count={3} />`
- Vide → `<EmptyState icon={Radar} title="Aucune mission" />`

### ContactsPage
- `<PageHeading title="Mon équipe" />`
- Chargement → `<SkeletonCard count={4} />`
- Vide → `<EmptyState icon={Users} title="Aucun contact" subtitle="Ajoute un contact via son identifiant GeoGN." />`

### ProfilePage
- `<PageHeading title="Profil" />`
- Fix `rounded-lg` → `rounded-2xl`

### MissionZonesPage
- `<PageHeading title="Zones" />`
- Chargement → `<SkeletonCard count={3} />`
- Vide → `<EmptyState icon={CircleDotDashed} title="Aucune zone" subtitle="Crée une zone depuis la carte." />`

### MissionPoisPage & MissionContactsPage
- Même traitement : `PageHeading` + `SkeletonCard` + `EmptyState`

---

## Fichiers impactés

**Nouveaux fichiers**
- `frontend/src/components/ui/Skeleton.tsx`
- `frontend/src/components/ui/SkeletonCard.tsx`
- `frontend/src/components/ui/EmptyState.tsx`
- `frontend/src/components/ui/PageHeading.tsx`
- `frontend/src/components/ui/KeepAliveOutlet.tsx`

**Fichiers modifiés**
- `frontend/package.json` — ajout `framer-motion`
- `frontend/src/index.css` — animation shimmer keyframes
- `frontend/src/pages/AppShell.tsx` — KeepAliveOutlet + AnimatePresence
- `frontend/src/pages/MissionLayout.tsx` — KeepAliveOutlet + AnimatePresence
- `frontend/src/pages/CurrentMissionPage.tsx`
- `frontend/src/pages/MissionsPage.tsx`
- `frontend/src/pages/ContactsPage.tsx`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/MissionZonesPage.tsx`
- `frontend/src/pages/MissionPoisPage.tsx`
- `frontend/src/pages/MissionContactsPage.tsx`

**Non modifiés (logique intacte)**
- Tous les fichiers backend
- `MapLibreMap.tsx` (logique carte)
- Contexts, hooks, lib/api, lib/socket

---

## Ordre d'implémentation recommandé

1. Créer les 4 primitives UI (`Skeleton`, `SkeletonCard`, `EmptyState`, `PageHeading`)
2. Ajouter `framer-motion` + keyframe shimmer dans `index.css`
3. Implémenter `KeepAliveOutlet` + adapter `AppShell` et `MissionLayout`
4. Appliquer page par page : corrections visuelles + primitives
5. Homogénéiser les états boutons sur toutes les pages
