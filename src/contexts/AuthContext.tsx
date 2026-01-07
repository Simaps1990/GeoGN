import { createContext, useContext, useEffect, useState } from 'react';
import type { ApiUser } from '../lib/api';
import { clearTokens, getApiBaseUrl, login, me, register } from '../lib/api';

interface AuthContextType {
  user: ApiUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const startedAt = Date.now();
      // Safe diagnostics (no secrets): helps debug mobile/prod networking issues.
      console.log('[auth] bootstrap start', { apiBaseUrl: getApiBaseUrl() });
      try {
        const current = await me();
        console.log('[auth] bootstrap me() ok', {
          tookMs: Date.now() - startedAt,
          hasUser: Boolean(current),
        });
        setUser(current);
      } catch (e: any) {
        if (e?.message === 'NOT_FOUND') {
          clearTokens();
          setUser(null);
        }
        console.warn('[auth] bootstrap me() failed', {
          tookMs: Date.now() - startedAt,
          message: e?.message,
        });
      } finally {
        console.log('[auth] bootstrap done', { tookMs: Date.now() - startedAt });
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const u = await login(email, password);
    setUser(u);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const u = await register(email, password, displayName);
    setUser(u);
  };

  const signOut = async () => {
    // Clear auth tokens **and** any cached mission/map state so the next
    // session doesn't inherit a mission the new user can't access.
    clearTokens();
    try {
      // Selected mission
      localStorage.removeItem('geotacops.selectedMissionId');

      // Saved map views per mission
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('geotacops.mapView.')) {
          toRemove.push(key);
        }
      }
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }

      // Pending explicit centering instructions
      sessionStorage.removeItem('geogn.centerPoi');
      sessionStorage.removeItem('geogn.centerZone');
    } catch {
      // ignore storage errors
    }
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const current = await me();
      setUser(current);
    } catch (e: any) {
      if (e?.message === 'NOT_FOUND') {
        clearTokens();
        setUser(null);
        return;
      }
      throw e;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
