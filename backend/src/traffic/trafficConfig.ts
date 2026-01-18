export type TrafficProvider = 'tomtom' | 'none';

const RAW_PROVIDER = (process.env.TRAFFIC_PROVIDER || 'none').toLowerCase();

export const TRAFFIC_PROVIDER: TrafficProvider =
  RAW_PROVIDER === 'tomtom' ? 'tomtom' : 'none';

export function isTomtomEnabled(): boolean {
  return TRAFFIC_PROVIDER === 'tomtom' && !!process.env.TOMTOM_API_KEY;
}

export function getTomtomApiKey(): string | null {
  const key = process.env.TOMTOM_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function getTomtomBaseUrl(): string {
  // Endpoint générique Traffic Flow, à adapter selon le type précis
  // d’API que tu utilises (flow segment, flow vector, etc.).
  return process.env.TOMTOM_BASE_URL?.replace(/\/$/, '') || 'https://api.tomtom.com';
}
