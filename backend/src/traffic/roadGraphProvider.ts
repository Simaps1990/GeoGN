import type { FeatureCollection, LineString, Point } from 'geojson';

export type RoadGraphProfile = 'car' | 'motorcycle' | 'scooter' | 'truck';

export interface SnapResult {
  lng: number;
  lat: number;
}

export interface RoadGraphTileEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMeters: number;
  geometry: LineString;
  roadClass?: string;
  oneway?: boolean;
  speedLimitKmh?: number;
}

export interface RoadGraphTileResponse {
  z: number;
  x: number;
  y: number;
  edges: RoadGraphTileEdge[];
}

export interface RoadGraphProvider {
  snap(input: { lng: number; lat: number; profile: RoadGraphProfile }): Promise<SnapResult | null>;
  getTileEdges(input: {
    z: number;
    x: number;
    y: number;
    profile: RoadGraphProfile;
  }): Promise<RoadGraphTileResponse | null>;
}

export interface HttpRoadGraphProviderOptions {
  baseUrl: string; // e.g. http://road-graph:4000
  timeoutMs?: number;
}

export class HttpRoadGraphProvider implements RoadGraphProvider {
  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  constructor(options: HttpRoadGraphProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    // Timeout généreux par défaut (2 minutes) pour laisser le temps à un
    // service Render Free de sortir du mode veille. Il peut être réduit via
    // les options si nécessaire.
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async snap(input: { lng: number; lat: number; profile: RoadGraphProfile }): Promise<SnapResult | null> {
    const url = new URL('/snap', this.baseUrl);
    url.searchParams.set('lng', String(input.lng));
    url.searchParams.set('lat', String(input.lat));
    url.searchParams.set('profile', input.profile);

    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: this.createAbortSignal(),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { lng: number; lat: number } | null;
    if (!data || typeof data.lng !== 'number' || typeof data.lat !== 'number') return null;
    return { lng: data.lng, lat: data.lat };
  }

  async getTileEdges(input: {
    z: number;
    x: number;
    y: number;
    profile: RoadGraphProfile;
  }): Promise<RoadGraphTileResponse | null> {
    const url = new URL('/tile', this.baseUrl);
    url.searchParams.set('z', String(input.z));
    url.searchParams.set('x', String(input.x));
    url.searchParams.set('y', String(input.y));
    url.searchParams.set('profile', input.profile);

    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: this.createAbortSignal(),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as RoadGraphTileResponse | null;
    if (!data || !Array.isArray(data.edges)) return null;
    return data;
  }

  private createAbortSignal(): AbortSignal | undefined {
    if (typeof AbortController === 'undefined') return undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.timeoutMs).unref?.();
    return controller.signal;
  }
}
