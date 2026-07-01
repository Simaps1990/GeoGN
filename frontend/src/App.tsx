import { AuthProvider, useAuth } from './contexts/AuthContext';
import Auth from './components/Auth';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import AppShell from './pages/AppShell';
import { MissionProvider, useMission } from './contexts/MissionContext';
import { GridViewProvider } from './contexts/GridViewContext';

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
      <div
        className="min-h-screen w-full bg-black bg-cover bg-center bg-no-repeat flex items-center justify-center px-4 py-10"
        style={{ backgroundImage: "url('/icon/fondgris.png')" }}
      >
        <div className="w-full max-w-md rounded-3xl bg-[#1c1f24] px-8 pt-2 pb-8 shadow-[0_30px_90px_rgba(0,0,0,0.65)] ring-1 ring-white/10">
          <div className="flex flex-col items-center text-center">
            <img
              src="/icon/patte.png"
              alt="GeoGN"
              className="h-80 w-80 object-contain drop-shadow -mt-12 -mb-16"
            />
            <h1 className="-mt-4 text-4xl font-semibold tracking-wide text-white">GeoGN</h1>
          </div>
          <div className="mt-8 flex items-center justify-center gap-2">
            <span className="h-2 w-2 rounded-full bg-white/40 animate-bounce [animation-delay:-0.3s]" />
            <span className="h-2 w-2 rounded-full bg-white/40 animate-bounce [animation-delay:-0.15s]" />
            <span className="h-2 w-2 rounded-full bg-white/40 animate-bounce" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <Routes>
        <Route path="/login" element={<Navigate to="/home" replace />} />
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

        <Route path="/mission/:missionId/*" element={<GridViewProvider><MissionLayout /></GridViewProvider>}>
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
