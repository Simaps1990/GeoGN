import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getApiBaseUrl, refreshTokens } from './api';

let socket: Socket | null = null;
let lastToken: string | null = null;
let lastBaseUrl: string | null = null;
let refreshing: boolean = false;

export function getSocket() {
  const baseUrl = getApiBaseUrl();
  const token = getAccessToken();

  if (socket && lastBaseUrl && lastBaseUrl !== baseUrl) {
    resetSocket();
  }

  if (!socket) {
    lastBaseUrl = baseUrl;
    socket = io(baseUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });

    // Handle connection errors due to expired token
    socket.on('connect_error', async (error) => {
      if (refreshing || !socket) return;
      
      const errorMessage = error.message?.toLowerCase() || '';
      if (errorMessage.includes('unauthorized') || errorMessage.includes('jwt') || errorMessage.includes('expired')) {
        refreshing = true;
        try {
          // Try to refresh tokens directly
          const newToken = await refreshTokens();
          // If successful, update token and reconnect
          if (newToken && newToken !== lastToken) {
            socket.auth = { token: newToken };
            lastToken = newToken;
            socket.disconnect();
            socket.connect();
          }
        } catch {
          // Refresh failed, don't attempt reconnect
          console.warn('[socket] Token refresh failed, user will need to re-authenticate');
        } finally {
          refreshing = false;
        }
      }
    });
  }

  // Keep auth token up-to-date. If the socket was created before auth loaded,
  // this ensures it can connect later and receive mission snapshots.
  if (token && token !== lastToken) {
    socket.auth = { token };
    lastToken = token;
  }

  if (token && !socket.connected) {
    socket.connect();
  }

  return socket;
}

export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    lastToken = null;
    lastBaseUrl = null;
    refreshing = false;
  }
}
