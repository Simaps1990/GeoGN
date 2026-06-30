# Visual Audit GeoGN — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Élever le rendu visuel intérieur de l'app au niveau iOS-like premium, sans toucher à la logique métier.

**Architecture:** Primitives UI partagées (`Skeleton`, `SkeletonCard`, `EmptyState`, `PageHeading`) dans `components/ui/`. Keep-alive routing dans `AppShell` et `MissionLayout` via rendu conditionnel + classe `hidden`. Animations boutons en CSS pur.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, React Router v6, Vite.

## Global Constraints

- Ne modifier aucune logique métier (state, appels API, socket events, calculs)
- Aucun commit ni push sans accord explicite de l'utilisateur
- Pas de `framer-motion` dans cette itération (prévu pour modales/bottom-sheets en V2)
- `npm run typecheck` doit passer après chaque tâche
- Vérification visuelle via `npm run dev` (port 5173 par défaut)

---

## Fichiers créés / modifiés

**Nouveaux fichiers**
- `frontend/src/components/ui/Skeleton.tsx`
- `frontend/src/components/ui/SkeletonCard.tsx`
- `frontend/src/components/ui/EmptyState.tsx`
- `frontend/src/components/ui/PageHeading.tsx`

**Modifiés**
- `frontend/src/index.css` — keyframes shimmer + pageEnter
- `frontend/src/pages/AppShell.tsx` — keep-alive rendering
- `frontend/src/pages/MissionLayout.tsx` — keep-alive rendering + dispatch map:visible
- `frontend/src/components/MapLibreMap.tsx` — listener geogn:map:visible → map.resize()
- `frontend/src/pages/CurrentMissionPage.tsx`
- `frontend/src/pages/MissionsPage.tsx`
- `frontend/src/pages/ContactsPage.tsx`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/MissionZonesPage.tsx`
- `frontend/src/pages/MissionPoisPage.tsx`
- `frontend/src/pages/MissionContactsPage.tsx`

---

## Task 1 — CSS foundations

**Files:**
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: classe CSS `animate-shimmer` utilisable dans Skeleton ; keyframe `pageEnter` utilisée par AppShell/MissionLayout

- [ ] **Step 1 — Ajouter les keyframes à index.css**

Ouvrir `frontend/src/index.css` et ajouter après le bloc `body` existant :

```css
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@keyframes pageEnter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-shimmer {
  animation: shimmer 1.4s ease-in-out infinite;
}

.animate-page-enter {
  animation: pageEnter 0.15s ease-out both;
}
```

- [ ] **Step 2 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 3 — Vérification visuelle**

```bash
npm run dev
```
Aucun changement visible pour l'instant — les classes ne sont pas encore utilisées.

---

## Task 2 — Primitives Skeleton et SkeletonCard

**Files:**
- Create: `frontend/src/components/ui/Skeleton.tsx`
- Create: `frontend/src/components/ui/SkeletonCard.tsx`

**Interfaces:**
- Produces:
  - `<Skeleton className="..." />` — bloc shimmer générique
  - `<SkeletonCard count={N} />` — N cartes squelettes empilées

- [ ] **Step 1 — Créer Skeleton.tsx**

```tsx
// frontend/src/components/ui/Skeleton.tsx
type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gray-100 ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}
```

- [ ] **Step 2 — Créer SkeletonCard.tsx**

```tsx
// frontend/src/components/ui/SkeletonCard.tsx
import { Skeleton } from './Skeleton';

type SkeletonCardProps = {
  count?: number;
};

function SingleSkeletonCard() {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-9 w-20 flex-shrink-0" />
      </div>
    </div>
  );
}

export function SkeletonCard({ count = 1 }: SkeletonCardProps) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }, (_, i) => (
        <SingleSkeletonCard key={i} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 4 — Vérification visuelle rapide**

Importer temporairement `<SkeletonCard count={3} />` dans n'importe quelle page pour confirmer l'effet shimmer. Supprimer l'import temporaire ensuite.

---

## Task 3 — Primitive EmptyState

**Files:**
- Create: `frontend/src/components/ui/EmptyState.tsx`

**Interfaces:**
- Consumes: type `LucideIcon` de `lucide-react`
- Produces: `<EmptyState icon={Users} title="..." subtitle="..." />`

- [ ] **Step 1 — Créer EmptyState.tsx**

```tsx
// frontend/src/components/ui/EmptyState.tsx
import type { LucideIcon } from 'lucide-react';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
};

export function EmptyState({ icon: Icon, title, subtitle }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border bg-white px-4 py-10 shadow-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon size={32} className="text-gray-300" />
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {subtitle ? <p className="text-xs text-gray-400">{subtitle}</p> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

---

## Task 4 — Primitive PageHeading

**Files:**
- Create: `frontend/src/components/ui/PageHeading.tsx`

**Interfaces:**
- Produces: `<PageHeading title="..." subtitle="..." action={<ReactNode />} />`

- [ ] **Step 1 — Créer PageHeading.tsx**

```tsx
// frontend/src/components/ui/PageHeading.tsx
import type { ReactNode } from 'react';

type PageHeadingProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function PageHeading({ title, subtitle, action }: PageHeadingProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

---

## Task 5 — AppShell keep-alive

**Files:**
- Modify: `frontend/src/pages/AppShell.tsx`

**Interfaces:**
- Consumes: `CurrentMissionPage`, `MissionsPage`, `ContactsPage`, `ProfilePage` (imports directs)
- Consumes: keyframe `animate-page-enter` de Task 1
- Produces: les 4 pages restent montées ; seule l'active est visible

**Note :** On remplace `<Outlet />` par un rendu conditionnel direct. Les `<Route>` dans `App.tsx` restent inchangées (elles gèrent les redirections), mais leur rendu via Outlet est bypassé.

- [ ] **Step 1 — Réécrire AppShell.tsx**

```tsx
// frontend/src/pages/AppShell.tsx
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { lazy, Suspense } from 'react';
import BottomTabs from '../components/BottomTabs';

const CurrentMissionPage = lazy(() => import('./CurrentMissionPage'));
const MissionsPage = lazy(() => import('./MissionsPage'));
const ContactsPage = lazy(() => import('./ContactsPage'));
const ProfilePage = lazy(() => import('./ProfilePage'));

const PAGES = ['home', 'missions', 'contacts', 'profile'] as const;
type PageKey = (typeof PAGES)[number];

function getActiveKey(pathname: string): PageKey {
  if (pathname.startsWith('/contacts')) return 'contacts';
  if (pathname.startsWith('/profile')) return 'profile';
  if (pathname.startsWith('/missions')) return 'missions';
  return 'home';
}

export default function AppShell() {
  const location = useLocation();
  const activeKey = getActiveKey(location.pathname);

  const visitedRef = useRef<Set<PageKey>>(new Set());
  visitedRef.current.add(activeKey);

  // Clé d'animation : change à chaque activation de page pour déclencher l'entrée CSS
  const enterKeyRef = useRef<Record<PageKey, number>>({ home: 0, missions: 0, contacts: 0, profile: 0 });
  const prevKeyRef = useRef<PageKey>(activeKey);
  if (prevKeyRef.current !== activeKey) {
    enterKeyRef.current[activeKey] = (enterKeyRef.current[activeKey] ?? 0) + 1;
    prevKeyRef.current = activeKey;
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="w-full">
        {visitedRef.current.has('home') && (
          <div className={activeKey === 'home' ? '' : 'hidden'}>
            <div key={`home-${enterKeyRef.current.home}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <CurrentMissionPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('missions') && (
          <div className={activeKey === 'missions' ? '' : 'hidden'}>
            <div key={`missions-${enterKeyRef.current.missions}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionsPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('contacts') && (
          <div className={activeKey === 'contacts' ? '' : 'hidden'}>
            <div key={`contacts-${enterKeyRef.current.contacts}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <ContactsPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('profile') && (
          <div className={activeKey === 'profile' ? '' : 'hidden'}>
            <div key={`profile-${enterKeyRef.current.profile}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <ProfilePage />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      <BottomTabs />
    </div>
  );
}
```

- [ ] **Step 2 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 3 — Vérification visuelle**

```bash
npm run dev
```
Naviguer entre Accueil / Équipe / Profil. Vérifier :
- Chaque page s'affiche correctement
- La navigation est instantanée (pas de flash blanc)
- L'animation d'entrée (fade + 4px) est visible à chaque changement d'onglet
- Le scroll revient en haut à chaque navigation

---

## Task 6 — MissionLayout keep-alive + signal map

**Files:**
- Modify: `frontend/src/pages/MissionLayout.tsx`

**Interfaces:**
- Consumes: `MissionMapPage`, `MissionZonesPage`, `MissionPoisPage`, `MissionContactsPage` (imports directs)
- Produces: dispatch `geogn:map:visible` quand la route map devient active

- [ ] **Step 1 — Réécrire MissionLayout.tsx**

```tsx
// frontend/src/pages/MissionLayout.tsx
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useMission } from '../contexts/MissionContext';
import { useAuth } from '../contexts/AuthContext';
import MissionTabs from '../components/MissionTabs';
import { useMissionGeolocation } from '../hooks/useMissionGeolocation';
import { getSocket } from '../lib/socket';

const MissionMapPage = lazy(() => import('./MissionMapPage'));
const MissionZonesPage = lazy(() => import('./MissionZonesPage'));
const MissionPoisPage = lazy(() => import('./MissionPoisPage'));
const MissionContactsPage = lazy(() => import('./MissionContactsPage'));

const MISSION_PAGES = ['map', 'zones', 'pois', 'contacts'] as const;
type MissionPageKey = (typeof MISSION_PAGES)[number];

function getActiveMissionKey(pathname: string): MissionPageKey {
  if (pathname.endsWith('/zones')) return 'zones';
  if (pathname.endsWith('/pois')) return 'pois';
  if (pathname.endsWith('/contacts')) return 'contacts';
  return 'map';
}

export default function MissionLayout() {
  const { missionId } = useParams();
  const { selectedMissionId, selectMission } = useMission();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeKey = getActiveMissionKey(location.pathname);
  const isMapRoute = activeKey === 'map';

  const visitedRef = useRef<Set<MissionPageKey>>(new Set());
  visitedRef.current.add(activeKey);

  const enterKeyRef = useRef<Record<MissionPageKey, number>>({ map: 0, zones: 0, pois: 0, contacts: 0 });
  const prevKeyRef = useRef<MissionPageKey>(activeKey);
  if (prevKeyRef.current !== activeKey) {
    enterKeyRef.current[activeKey] = (enterKeyRef.current[activeKey] ?? 0) + 1;
    prevKeyRef.current = activeKey;
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    if (!missionId) return;
    if (selectedMissionId !== missionId) {
      selectMission(missionId);
    }
  }, [missionId, selectedMissionId, selectMission]);

  // Signal MapLibre de recalculer sa taille quand la route map redevient active
  useEffect(() => {
    if (isMapRoute) {
      window.dispatchEvent(new CustomEvent('geogn:map:visible'));
    }
  }, [isMapRoute]);

  useEffect(() => {
    if (!missionId) return;
    const socket = getSocket();
    const onMissionDeleted = (msg: any) => {
      if (!msg || msg.missionId !== missionId) return;
      if (selectedMissionId === missionId) selectMission('');
      navigate('/');
    };
    socket.on('mission:deleted', onMissionDeleted);
    return () => { socket.off('mission:deleted', onMissionDeleted); };
  }, [missionId, selectedMissionId, selectMission, navigate]);

  useMissionGeolocation({
    missionId: missionId ?? null,
    userId: user?.id ?? null,
    enabled: !isMapRoute,
  });

  return (
    <div className={isMapRoute ? 'min-h-screen bg-gray-50' : 'min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]'}>
      <div className="w-full">
        {visitedRef.current.has('map') && (
          <div className={activeKey === 'map' ? '' : 'hidden'}>
            <Suspense fallback={null}>
              <MissionMapPage />
            </Suspense>
          </div>
        )}
        {visitedRef.current.has('zones') && (
          <div className={activeKey === 'zones' ? '' : 'hidden'}>
            <div key={`zones-${enterKeyRef.current.zones}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionZonesPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('pois') && (
          <div className={activeKey === 'pois' ? '' : 'hidden'}>
            <div key={`pois-${enterKeyRef.current.pois}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionPoisPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('contacts') && (
          <div className={activeKey === 'contacts' ? '' : 'hidden'}>
            <div key={`contacts-${enterKeyRef.current.contacts}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionContactsPage />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      <MissionTabs />
    </div>
  );
}
```

**Note :** La carte n'a pas d'animation d'entrée (`animate-page-enter`) car son conteneur full-screen et son canvas MapLibre doivent se stabiliser instantanément.

- [ ] **Step 2 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 3 — Vérification visuelle**

```bash
npm run dev
```
Dans une mission, naviguer entre Carte / Zones / POI / Équipe. Vérifier :
- La carte ne se réinitialise plus en revenant dessus
- Les listes Zones/POI/Équipe conservent leur état (données chargées, position de scroll)
- L'animation d'entrée est visible sur Zones, POI, Équipe

---

## Task 7 — MapLibre resize sur geogn:map:visible

**Files:**
- Modify: `frontend/src/components/MapLibreMap.tsx` — ajouter un `useEffect` qui écoute `geogn:map:visible` et appelle `map.resize()`

**Interfaces:**
- Consumes: `mapReady` (booléen existant), ref vers l'instance MapLibre (`mapRef` ou équivalent)

- [ ] **Step 1 — Ajouter le useEffect de resize dans MapLibreMap.tsx**

Dans `MapLibreMap.tsx`, après la déclaration de `const [mapReady, setMapReady] = useState(false);` (ligne ~514), ajouter ce `useEffect` à la suite des autres effets liés à `mapReady` :

```tsx
// Resize MapLibre quand son conteneur redevient visible (keep-alive routing)
useEffect(() => {
  const onMapVisible = () => {
    if (mapReady && mapInstanceRef.current) {
      mapInstanceRef.current.resize();
    }
  };
  window.addEventListener('geogn:map:visible', onMapVisible);
  return () => {
    window.removeEventListener('geogn:map:visible', onMapVisible);
  };
}, [mapReady]);
```

`mapInstanceRef` est la ref existante de type `useRef<MapLibreMapInstance | null>(null)` (ligne ~416). `mapReady` est le state booléen existant (ligne ~514).

- [ ] **Step 3 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 4 — Vérification visuelle**

Dans une mission, aller sur la carte, zoomer sur une zone, naviguer vers Zones, revenir sur la carte. Vérifier :
- La carte affiche correctement sa taille (pas de zone grise)
- Le zoom et la position de la carte sont conservés

---

## Task 8 — États boutons globaux

**Files:**
- Modify: tous les fichiers de pages listés ci-dessous

**Interfaces:**
- Produit: boutons avec `active:scale-[0.97] transition-transform duration-100`, `disabled:opacity-40 disabled:pointer-events-none`, `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`

**Pattern à appliquer sur chaque bouton primaire (bg-blue-600, bg-green-600, bg-gray-900) :**

Remplacer les occurrences de `disabled:opacity-50` par :
```
disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97] transition-transform duration-100
```

Et ajouter sur les boutons interactifs existants qui n'ont pas de focus ring :
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
```

- [ ] **Step 1 — Appliquer dans CurrentMissionPage.tsx**

Remplacer dans ce fichier toutes les occurrences de `disabled:opacity-50` par `disabled:opacity-40 disabled:pointer-events-none`. Ajouter `active:scale-[0.97] transition-transform duration-100` sur tous les `<button>`.

- [ ] **Step 2 — Appliquer dans MissionsPage.tsx**

Même opération.

- [ ] **Step 3 — Appliquer dans ContactsPage.tsx**

Même opération.

- [ ] **Step 4 — Appliquer dans ProfilePage.tsx**

Même opération.

- [ ] **Step 5 — Appliquer dans MissionZonesPage.tsx**

Même opération.

- [ ] **Step 6 — Appliquer dans MissionPoisPage.tsx**

Même opération.

- [ ] **Step 7 — Appliquer dans MissionContactsPage.tsx**

Même opération.

- [ ] **Step 8 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 9 — Vérification visuelle**

Appuyer sur un bouton (ex: "Créer" sur l'Accueil). Vérifier le micro-press `scale-[0.97]`. Vérifier qu'un bouton disabled ne répond plus au clic.

---

## Task 9 — CurrentMissionPage visuel

**Files:**
- Modify: `frontend/src/pages/CurrentMissionPage.tsx`

**Interfaces:**
- Consumes: `PageHeading` de `../components/ui/PageHeading`, `SkeletonCard` de `../components/ui/SkeletonCard`, `EmptyState` de `../components/ui/EmptyState`
- Consumes: icône `Target` de `lucide-react` (déjà importée)

- [ ] **Step 1 — Ajouter les imports UI**

Dans `CurrentMissionPage.tsx`, ajouter en haut :
```tsx
import { PageHeading } from '../components/ui/PageHeading';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { EmptyState } from '../components/ui/EmptyState';
```
Ajouter `Target` à l'import lucide-react existant si absent.

- [ ] **Step 2 — Remplacer le titre**

Remplacer :
```tsx
<div className="flex items-center justify-center">
  <h1 className="text-xl font-bold text-gray-900">GeoGN</h1>
</div>
```
Par :
```tsx
<PageHeading title="GeoGN" subtitle="Géolocalisation opérationnelle" />
```

- [ ] **Step 3 — Remplacer l'état de chargement de la liste missions**

Remplacer :
```tsx
{missionsLoading ? (
  <div className="mt-2 text-sm text-gray-600">Chargement…</div>
```
Par :
```tsx
{missionsLoading ? (
  <div className="mt-2"><SkeletonCard count={2} /></div>
```

- [ ] **Step 4 — Remplacer l'état vide de la liste missions**

Remplacer :
```tsx
) : missions.length === 0 ? (
  <div className="mt-2 text-sm text-gray-600">Aucune mission.</div>
```
Par :
```tsx
) : missions.length === 0 ? (
  <div className="mt-2">
    <EmptyState icon={Target} title="Aucune mission" subtitle="Crée ou rejoins une mission pour commencer." />
  </div>
```

- [ ] **Step 5 — Vérifier TypeScript**

```bash
cd frontend && npm run typecheck
```
Attendu : aucune erreur.

- [ ] **Step 6 — Vérification visuelle**

```bash
npm run dev
```
Naviguer vers `/home`. Vérifier : titre plus grand avec sous-titre, skeleton cards pendant le chargement, EmptyState si aucune mission.

---

## Task 10 — MissionsPage visuel

**Files:**
- Modify: `frontend/src/pages/MissionsPage.tsx`

**Interfaces:**
- Consumes: `PageHeading`, `SkeletonCard`, `EmptyState`
- Consumes: icône `Radar` de `lucide-react`

- [ ] **Step 1 — Ajouter les imports**

```tsx
import { PageHeading } from '../components/ui/PageHeading';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { EmptyState } from '../components/ui/EmptyState';
import { Radar, RefreshCcw, Plus, ArrowRight } from 'lucide-react';
```
(conserver les imports lucide déjà présents, ajouter `Radar` si absent)

- [ ] **Step 2 — Remplacer le header**

Remplacer :
```tsx
<div className="flex items-center justify-between">
  <h1 className="text-xl font-bold text-gray-900">Missions</h1>
  <button
    type="button"
    onClick={() => void refresh()}
    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
  >
    <RefreshCcw size={16} />
    Actualiser
  </button>
</div>
```
Par :
```tsx
<PageHeading
  title="Missions"
  action={
    <button
      type="button"
      onClick={() => void refresh()}
      className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50 active:scale-[0.97] transition-transform duration-100"
    >
      <RefreshCcw size={16} />
      Actualiser
    </button>
  }
/>
```

- [ ] **Step 3 — Remplacer chargement et état vide**

Remplacer :
```tsx
{loading ? (
  <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
) : sorted.length === 0 ? (
  <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">
    Aucune mission pour le moment.
  </div>
```
Par :
```tsx
{loading ? (
  <SkeletonCard count={3} />
) : sorted.length === 0 ? (
  <EmptyState icon={Radar} title="Aucune mission" subtitle="Crée une mission ci-dessus pour commencer." />
```

- [ ] **Step 4 — Vérifier TypeScript + visuel**

```bash
cd frontend && npm run typecheck && npm run dev
```

---

## Task 11 — ContactsPage visuel

**Files:**
- Modify: `frontend/src/pages/ContactsPage.tsx`

**Interfaces:**
- Consumes: `PageHeading`, `SkeletonCard`, `EmptyState`
- Consumes: icône `Users` de `lucide-react`

- [ ] **Step 1 — Ajouter les imports**

```tsx
import { PageHeading } from '../components/ui/PageHeading';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { EmptyState } from '../components/ui/EmptyState';
import { Plus, Trash2, Users } from 'lucide-react';
```

- [ ] **Step 2 — Remplacer le titre**

Remplacer :
```tsx
<div className="flex items-center justify-between">
  <h1 className="text-xl font-bold text-gray-900">Mon équipe</h1>
</div>
```
Par :
```tsx
<PageHeading title="Mon équipe" />
```

- [ ] **Step 3 — Remplacer chargement et état vide**

Remplacer :
```tsx
{loading ? (
  <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
) : sorted.length === 0 ? (
  <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun contact.</div>
```
Par :
```tsx
{loading ? (
  <SkeletonCard count={4} />
) : sorted.length === 0 ? (
  <EmptyState icon={Users} title="Aucun contact" subtitle="Ajoute un contact via son identifiant GeoGN." />
```

- [ ] **Step 4 — Vérifier TypeScript + visuel**

```bash
cd frontend && npm run typecheck && npm run dev
```

---

## Task 12 — ProfilePage visuel

**Files:**
- Modify: `frontend/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `PageHeading`

- [ ] **Step 1 — Ajouter l'import**

```tsx
import { PageHeading } from '../components/ui/PageHeading';
```

- [ ] **Step 2 — Remplacer le titre**

Remplacer :
```tsx
<h1 className="text-xl font-bold text-gray-900">Profil</h1>
```
Par :
```tsx
<PageHeading title="Profil" />
```

- [ ] **Step 3 — Corriger l'incohérence rounded-lg → rounded-2xl**

Dans `ProfilePage.tsx`, remplacer toutes les occurrences de `rounded-lg` par `rounded-2xl` (4 occurrences — les cartes info, modifier pseudo, changer mot de passe, partager code, paramètres).

```bash
grep -n "rounded-lg" frontend/src/pages/ProfilePage.tsx
```
Remplacer chaque occurrence manuellement.

- [ ] **Step 4 — Vérifier TypeScript + visuel**

```bash
cd frontend && npm run typecheck && npm run dev
```
Vérifier que toutes les cartes de la page Profil ont le même border-radius que les autres pages.

---

## Task 13 — MissionZonesPage visuel

**Files:**
- Modify: `frontend/src/pages/MissionZonesPage.tsx`

**Interfaces:**
- Consumes: `PageHeading`, `SkeletonCard`, `EmptyState`
- Consumes: icône `CircleDotDashed` (déjà importée dans ce fichier)

- [ ] **Step 1 — Ajouter les imports**

```tsx
import { PageHeading } from '../components/ui/PageHeading';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { EmptyState } from '../components/ui/EmptyState';
```

- [ ] **Step 2 — Remplacer le titre**

Remplacer :
```tsx
<h1 className="text-xl font-bold text-gray-900">Gestion des Zones</h1>
```
Par :
```tsx
<PageHeading title="Zones" />
```

- [ ] **Step 3 — Remplacer chargement et état vide**

Remplacer :
```tsx
{loading ? (
  <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
) : zones.length === 0 ? (
  <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucune zone.</div>
```
Par :
```tsx
{loading ? (
  <div className="mt-3"><SkeletonCard count={3} /></div>
) : zones.length === 0 ? (
  <div className="mt-3">
    <EmptyState icon={CircleDotDashed} title="Aucune zone" subtitle="Crée une zone depuis la carte." />
  </div>
```

- [ ] **Step 4 — Vérifier TypeScript + visuel**

```bash
cd frontend && npm run typecheck && npm run dev
```

---

## Task 14 — MissionPoisPage visuel

**Files:**
- Modify: `frontend/src/pages/MissionPoisPage.tsx`

**Interfaces:**
- Consumes: `PageHeading`, `SkeletonCard`, `EmptyState`
- Consumes: icône `MapPin` de `lucide-react` (présente dans ce fichier)

- [ ] **Step 1 — Ajouter les imports**

```tsx
import { PageHeading } from '../components/ui/PageHeading';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { EmptyState } from '../components/ui/EmptyState';
```

- [ ] **Step 2 — Remplacer le titre (ligne ~230)**

Remplacer :
```tsx
<h1 className="text-xl font-bold text-gray-900">Gestion des Points d'Interet</h1>
```
Par :
```tsx
<PageHeading title="Points d'intérêt" />
```

- [ ] **Step 3 — Remplacer chargement et état vide (lignes ~232-234)**

Remplacer :
```tsx
<div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
```
Par :
```tsx
<div className="mt-3"><SkeletonCard count={3} /></div>
```

Remplacer :
```tsx
<div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun POI.</div>
```
Par :
```tsx
<div className="mt-3"><EmptyState icon={MapPin} title="Aucun point d'intérêt" subtitle="Ajoute un POI depuis la carte." /></div>
```

- [ ] **Step 4 — Vérifier TypeScript + visuel**

```bash
cd frontend && npm run typecheck && npm run dev
```

---

## Task 15 — MissionContactsPage visuel

**Files:**
- Modify: `frontend/src/pages/MissionContactsPage.tsx`

**Interfaces:**
- Consumes: `PageHeading`, `SkeletonCard`, `EmptyState`
- Consumes: icône `BookUser` de `lucide-react`

- [ ] **Step 1 — Ajouter les imports**

```tsx
import { PageHeading } from '../components/ui/PageHeading';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { EmptyState } from '../components/ui/EmptyState';
import { BookUser } from 'lucide-react';
```

- [ ] **Step 2 — Remplacer le titre (ligne ~414)**

Remplacer :
```tsx
<h1 className="text-xl font-bold text-gray-900">Gestion de mon équipe</h1>
```
Par :
```tsx
<PageHeading title="Équipe mission" />
```

- [ ] **Step 3 — Remplacer chargement et état vide membres (lignes ~644-646)**

Remplacer :
```tsx
<div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
```
Par :
```tsx
<div className="mt-3"><SkeletonCard count={4} /></div>
```

Remplacer :
```tsx
<div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun membre.</div>
```
Par :
```tsx
<div className="mt-3"><EmptyState icon={BookUser} title="Aucun membre" subtitle="Invite des membres depuis l'Accueil." /></div>
```

- [ ] **Step 4 — Vérification finale complète**

```bash
cd frontend && npm run typecheck && npm run dev
```

Parcours complet :
1. Page de connexion → se connecter
2. Accueil : vérifier titre, skeleton, empty state
3. Équipe : idem
4. Profil : vérifier rounded-2xl uniforme
5. Ouvrir une mission
6. Naviguer entre Carte / Zones / POI / Équipe
7. Revenir sur la Carte : vérifier qu'elle n'a pas rechargé
8. Appuyer sur plusieurs boutons : vérifier l'effet scale press
9. `npm run typecheck` : 0 erreur

---

## Notes pour itérations futures

- **Framer Motion** : prévu pour les animations de modales (`ConfirmDialog`, `TimerModal`, `PersonPanelOverlay`) et le bottom-sheet PersonPanel. Ces composants se montent/démontent — AnimatePresence fonctionne parfaitement dans ce cas.
- **Transitions de pages** : peuvent être ajoutées par-dessus le keep-alive en animant l'opacité du wrapper `animate-page-enter` avec Framer Motion's `motion.div` et `layoutId`.
- **Boutons primaires gradient** : extension possible en ajoutant `bg-gradient-to-b from-blue-500 to-blue-700 shadow-[0_4px_14px_rgba(37,99,235,0.3)]` sur les CTAs principaux pour matcher l'esthétique de la page de connexion.
