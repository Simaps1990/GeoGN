import { createContext, useContext, useEffect, useState } from 'react';
import type { ApiUser } from '../lib/api';
import { clearTokens, getApiBaseUrl, login, me, register, setTokens } from '../lib/api';

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
      try {
        // 1) Tenter d'abord une session BFF (Keycloak) via /api/me
        try {
          const baseUrl = getApiBaseUrl();
          const res = await fetch(`${baseUrl}/api/me`, {
            method: 'GET',
            credentials: 'include',
          });
          if (res.ok) {
            const data: any = await res.json().catch(() => null);
            if (data && data.authenticated && data.user) {
              // On a une session BFF (Keycloak). On attache maintenant un compte appli + JWT.
              const attachRes = await fetch(`${baseUrl}/auth/oidc/attach`, {
                method: 'POST',
                credentials: 'include',
              });
              if (attachRes.ok) {
                const attach: any = await attachRes.json().catch(() => null);
                if (attach && attach.accessToken && attach.refreshToken && attach.user) {
                  setTokens(attach.accessToken, attach.refreshToken);
                  try {
                    if (attach.user.id) {
                      localStorage.setItem(LAST_USER_KEY, String(attach.user.id));
                    }
                  } catch {
                    // ignore
                  }
                  setUser(attach.user as ApiUser);
                  return;
                }
              }
            }
          }
        } catch {
          // ignore, on retombe sur le flux JWT existant
        }

        // 2) Sinon, tenter l'API JWT existante
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
          try {
            localStorage.removeItem(LAST_USER_KEY);
          } catch {
            // ignore
          }
          setUser(null);
        }
      } finally {
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
    // 1) Nettoyage local (JWT + état mission)
    clearTokens();
    clearCachedMissionState();
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch {
      // ignore
    }
    setUser(null);

    // 2) Redirection complète vers le backend pour fermer la session BFF/Keycloak
    // Utiliser une navigation de page (pas fetch) pour éviter les problèmes CORS
    // et laisser Keycloak gérer la redirection post-logout.
    try {
      const baseUrl = getApiBaseUrl();
      window.location.href = `${baseUrl}/api/logout`;
    } catch {
      // En cas de problème, on reste simplement déconnecté côté appli.
    }
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
