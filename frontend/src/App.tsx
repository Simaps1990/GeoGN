import { AuthProvider, useAuth } from './contexts/AuthContext';
import Auth from './components/Auth';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './pages/AppShell';
import MissionsPage from './pages/MissionsPage';
import ContactsPage from './pages/ContactsPage';
import ProfilePage from './pages/ProfilePage';
import CurrentMissionPage from './pages/CurrentMissionPage';
import MissionLayout from './pages/MissionLayout';
import MissionMapPage from './pages/MissionMapPage';
import MissionZonesPage from './pages/MissionZonesPage';
import MissionPoisPage from './pages/MissionPoisPage';
import MissionContactsPage from './pages/MissionContactsPage';
import { MissionProvider, useMission } from './contexts/MissionContext';

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
