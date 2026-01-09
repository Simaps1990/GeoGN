import { createContext, useContext, useEffect, useState } from 'react';
import type { ApiUser } from '../lib/api';
import { clearTokens, getApiBaseUrl, login, me, register } from '../lib/api';

const SELECTED_MISSION_KEY = 'geotacops.selectedMissionId';
const LAST_USER_KEY = 'geotacops.lastUserId';

function clearCachedMissionState() {
  try {
    // Selected mission
    localStorage.removeItem(SELECTED_MISSION_KEY);

    // Saved map views per mission
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith('geotacops.mapView.') ||
          key.startsWith('geogn.trace.self.') ||
          key.startsWith('geogn.trace.others.'))
      ) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
    }

    // Pending explicit centering instructions
    sessionStorage.removeItem('geogn.centerPoi');
    sessionStorage.removeItem('geogn.centerZone');

    // Sync MissionContext immediately
    window.dispatchEvent(new Event('geotacops:mission:clear'));
  } catch {
    // ignore storage errors
  }
}

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

        try {
          const lastUserId = localStorage.getItem(LAST_USER_KEY);
          if (lastUserId && current?.id && lastUserId !== current.id) {
            clearCachedMissionState();
          }
          if (current?.id) {
            localStorage.setItem(LAST_USER_KEY, current.id);
          }
        } catch {
          // ignore
        }

        setUser(current);
      } catch (e: any) {
        if (e?.message === 'NOT_FOUND') {
          clearTokens();
          try {
            localStorage.removeItem(LAST_USER_KEY);
          } catch {
            // ignore
          }
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
    clearCachedMissionState();
    try {
      localStorage.setItem(LAST_USER_KEY, u.id);
    } catch {
      // ignore
    }
    setUser(u);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const u = await register(email, password, displayName);
    clearCachedMissionState();
    try {
      localStorage.setItem(LAST_USER_KEY, u.id);
    } catch {
      // ignore
    }
    setUser(u);
  };

  const signOut = async () => {
    clearTokens();
    clearCachedMissionState();
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch {
      // ignore
    }
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const current = await me();

      try {
        const lastUserId = localStorage.getItem(LAST_USER_KEY);
        if (lastUserId && current?.id && lastUserId !== current.id) {
          clearCachedMissionState();
        }
        if (current?.id) {
          localStorage.setItem(LAST_USER_KEY, current.id);
        }
      } catch {
        // ignore
      }

      setUser(current);
    } catch (e: any) {
      if (e?.message === 'NOT_FOUND') {
        clearTokens();
        clearCachedMissionState();
        try {
          localStorage.removeItem(LAST_USER_KEY);
        } catch {
          // ignore
        }
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
