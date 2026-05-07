import { AuthProvider, useAuth } from './contexts/AuthContext';
import Auth from './components/Auth';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import AppShell from './pages/AppShell';
import { MissionProvider, useMission } from './contexts/MissionContext';

// Lazy-loaded pages
const MissionsPage = lazy(() => import('./pages/MissionsPage'));
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const CurrentMissionPage = lazy(() => import('./pages/CurrentMissionPage'));
const MissionLayout = lazy(() => import('./pages/MissionLayout'));
const MissionMapPage = lazy(() => import('./pages/MissionMapPage'));
const MissionZonesPage = lazy(() => import('./pages/MissionZonesPage'));
const MissionPoisPage = lazy(() => import('./pages/MissionPoisPage'));
const MissionContactsPage = lazy(() => import('./pages/MissionContactsPage'));

function MapGate() {
  const { selectedMissionId } = useMission();
  if (!selectedMissionId) {
    return <Navigate to="/home" replace />;
  }
  return <Navigate to={`/mission/${selectedMissionId}/map`} replace />;
}

function IndexRedirect() {
  return <Navigate to="/home" replace />;
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<IndexRedirect />} />
          <Route path="/map" element={<MapGate />} />
          <Route path="/home" element={<CurrentMissionPage />} />
          <Route path="/missions" element={<MissionsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Route>

        <Route path="/m/:missionId/*" element={<Navigate to="/mission/:missionId" replace />} />

        <Route path="/mission/:missionId/*" element={<MissionLayout />}>
          <Route index element={<Navigate to="map" replace />} />
          <Route path="map" element={<MissionMapPage />} />
          <Route path="zones" element={<MissionZonesPage />} />
          <Route path="pois" element={<MissionPoisPage />} />
          <Route path="contacts" element={<MissionContactsPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <AuthProvider>
      <MissionProvider>
        <AppContent />
      </MissionProvider>
    </AuthProvider>
  );
}

export default App;
