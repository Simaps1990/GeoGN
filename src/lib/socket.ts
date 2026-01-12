import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getApiBaseUrl } from './api';

let socket: Socket | null = null;
let lastToken: string | null = null;
let lastBaseUrl: string | null = null;

export function getSocket() {
  const baseUrl = getApiBaseUrl();
  const token = getAccessToken();

  if (socket && lastBaseUrl && lastBaseUrl !== baseUrl) {
    resetSocket();
  }

  if (!socket) {
    lastBaseUrl = baseUrl;
    socket = io(baseUrl, {
      transports: ['websocket'],
      autoConnect: false,
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
  }
}
