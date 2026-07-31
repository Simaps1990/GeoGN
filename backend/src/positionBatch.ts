export type BufferedPosition = {
  userId: string;
  lng: number;
  lat: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  t: number;
  color: string;
  retentionSeconds: number;
};

export type TraceInsert = {
  missionId: string;
  userId: string;
  color: string;
  lng: number;
  lat: number;
  createdAt: number;
  expiresAt: number;
};

export function selectTraceInserts(
  points: BufferedPosition[],
  missionId: string,
  lastTraceTsByUserMission: Map<string, number>,
  traceThrottleMs: number
): TraceInsert[] {
  const inserts: TraceInsert[] = [];
  for (const p of points) {
    const key = `${missionId}:${p.userId}`;
    const lastTs = lastTraceTsByUserMission.get(key);
    if (lastTs !== undefined && p.t - lastTs < traceThrottleMs) continue;
    inserts.push({
      missionId,
      userId: p.userId,
      color: p.color,
      lng: p.lng,
      lat: p.lat,
      createdAt: p.t,
      expiresAt: p.t + Math.max(0, p.retentionSeconds) * 1000,
    });
    lastTraceTsByUserMission.set(key, p.t);
  }
  return inserts;
}
