import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getApiBaseUrl } from './api';

let socket: Socket | null = null;

export function getSocket() {
  if (socket) return socket;

  const baseUrl = getApiBaseUrl();
  const token = getAccessToken();

  socket = io(baseUrl, {
    transports: ['websocket'],
    auth: token ? { token } : undefined,
  });

  return socket;
}

export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
