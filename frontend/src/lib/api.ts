import type { FeatureCollection } from 'geojson';

export type ApiUser = {
  id: string;
  appUserId: string;
  displayName: string;
  email?: string;
};

export type ApiMission = {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'closed';
  mapStyle: string;
  traceRetentionSeconds: number;
  createdAt: string;
  updatedAt: string;
  membership?: {
    role: 'admin' | 'member' | 'viewer';
    color: string;
    isActive: boolean;
    joinedAt: string | null;
  } | null;
};

export type ApiInvite = {
  id: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt: string;
  expiresAt: string;
  mission: { id: string; title: string; status: string } | null;
  invitedBy: { id: string; appUserId: string; displayName: string } | null;
};

export type ApiContact = {
  id: string;
  alias: string | null;
  createdAt: string;
  contact: { id: string; appUserId: string; displayName: string } | null;
};

export type ApiPoiType = 'zone_a_verifier' | 'doute' | 'cible_trouvee' | 'danger' | 'autre';

export type ApiPoi = {
  id: string;
  type: ApiPoiType;
  title: string;
  icon: string;
  color: string;
  comment: string;
  lng: number;
  lat: number;
  createdBy: string;
  createdAt: string;
};

export type ApiZone = {
  id: string;
  title: string;
  comment: string;
  color: string;
  type: 'circle' | 'polygon';
  circle: { center: { lng: number; lat: number }; radiusMeters: number } | null;
  polygon: { type: 'Polygon'; coordinates: number[][][] } | null;
  grid: { rows: number; cols: number; orientation?: 'vertical' | 'diag45' } | null;
  sectors:
    | {
        sectorId: string;
        color: string;
        geometry: { type: 'Polygon'; coordinates: number[][][] };
      }[]
    | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiVehicleTrackOrigin = {
  type: 'address' | 'poi';
  query: string;
  poiId?: string;
  lng?: number;
  lat?: number;
  when: string | null;
};

export type ApiVehicleTrackStatus = 'active' | 'stopped' | 'expired';
export type ApiVehicleTrackVehicleType = 'car' | 'motorcycle' | 'scooter' | 'truck' | 'unknown';
export type ApiVehicleTrackAlgorithm = 'mvp_isoline' | 'road_graph';

export type ApiVehicleTrackCache = {
  computedAt: string | null;
  elapsedSeconds: number;
  payloadGeojson: FeatureCollection | null;
  meta: any | null;
} | null;

export type ApiVehicleTrack = {
  id: string;
  missionId: string;
  createdBy: string;
  label: string;
  vehicleType: ApiVehicleTrackVehicleType;
  origin: ApiVehicleTrackOrigin;
  startedAt: string | null;
  maxDurationSeconds: number;
  trafficRefreshSeconds: number;
  status: ApiVehicleTrackStatus;
  algorithm: ApiVehicleTrackAlgorithm;
  lastComputedAt: string | null;
  cache: ApiVehicleTrackCache;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ApiVehicleTrackListResponse = {
  tracks: ApiVehicleTrack[];
  total: number;
};

export type ApiVehicleTrackStateResponse = {
  trackId: string;
  missionId: string;
  status: ApiVehicleTrackStatus;
  cache: ApiVehicleTrackCache;
};

export type ApiMissionMember = {
  user: { id: string; appUserId: string; displayName: string } | null;
  role: 'admin' | 'member' | 'viewer';
  color: string;
  isActive: boolean;
  joinedAt: string | null;
};

export type ApiMissionJoinRequest = {
  id: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  requestedBy: { id: string; appUserId: string; displayName: string } | null;
};

export type ApiPersonCase = {
  id: string;
  missionId: string;
  createdBy: string;
  lastKnown: {
    type: 'address' | 'poi';
    query: string;
    poiId?: string;
    lng?: number;
    lat?: number;
    when: string | null;
  };
  nextClue: {
    type: 'address' | 'poi';
    query: string;
    poiId?: string;
    lng?: number;
    lat?: number;
    when: string | null;
  } | null;
  mobility: 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car';
  age: number | null;
  sex: 'unknown' | 'female' | 'male';
  healthStatus: 'stable' | 'fragile' | 'critique';
  diseases: string[];
  injuries: { id: string; locations: string[] }[];
  diseasesFreeText: string;
  injuriesFreeText: string;
  createdAt: string;
  updatedAt: string;
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: ApiUser;
};

type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
};

const ACCESS_TOKEN_KEY = 'geotacops.accessToken';
const REFRESH_TOKEN_KEY = 'geotacops.refreshToken';

export function getApiBaseUrl() {
  return (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000';
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function rawFetch(path: string, init?: RequestInit) {
  const url = `${getApiBaseUrl()}${path}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (e: any) {
    throw e;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function refreshTokens() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  const res = await rawFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data = (await res.json()) as RefreshResponse;
  setTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

export async function apiFetch(path: string, init?: RequestInit) {
  const accessToken = getAccessToken();
  const res = await rawFetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (res.status !== 401) return res;

  const newToken = await refreshTokens();
  if (!newToken) return res;

  return rawFetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${newToken}`,
    },
  });
}

export async function register(email: string, password: string, displayName: string) {
  const res = await rawFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'REGISTER_FAILED');
  }
  const data = (await res.json()) as AuthResponse;
  setTokens(data.accessToken, data.refreshToken);
  return data.user;
}

export async function login(email: string, password: string) {
  const res = await rawFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LOGIN_FAILED');
  }
  const data = (await res.json()) as AuthResponse;
  setTokens(data.accessToken, data.refreshToken);
  return data.user;
}

export async function me() {
  const res = await apiFetch('/me');
  if (!res.ok) {
    if (res.status === 401) return null;
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'ME_FAILED');
  }
  return (await res.json()) as ApiUser;
}

export async function updateMyProfile(displayName: string) {
  const res = await apiFetch('/me', { method: 'PATCH', body: JSON.stringify({ displayName }) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_PROFILE_FAILED');
  }
  return (await res.json()) as ApiUser;
}

export async function changeMyPassword(currentPassword: string, newPassword: string) {
  const res = await apiFetch('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'CHANGE_PASSWORD_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function listVehicleTracks(
  missionId: string,
  params?: {
    status?: ApiVehicleTrackStatus;
    vehicleType?: ApiVehicleTrackVehicleType;
    q?: string;
    limit?: number;
    offset?: number;
  }
) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.vehicleType) searchParams.set('vehicleType', params.vehicleType);
  if (params?.q && params.q.trim()) searchParams.set('q', params.q.trim());
  if (typeof params?.limit === 'number') searchParams.set('limit', String(params.limit));
  if (typeof params?.offset === 'number') searchParams.set('offset', String(params.offset));

  const qs = searchParams.toString();
  const path = `/missions/${encodeURIComponent(missionId)}/vehicle-tracks${qs ? `?${qs}` : ''}`;

  const res = await apiFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_VEHICLE_TRACKS_FAILED');
  }
  return (await res.json()) as ApiVehicleTrackListResponse;
}

export async function createVehicleTrack(
  missionId: string,
  input: {
    label: string;
    vehicleType: ApiVehicleTrackVehicleType;
    origin: {
      type: 'address' | 'poi';
      query: string;
      poiId?: string;
      lng?: number;
      lat?: number;
      when?: string;
    };
    startedAt?: string;
    maxDurationSeconds?: number;
    algorithm?: ApiVehicleTrackAlgorithm;
  }
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/vehicle-tracks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'CREATE_VEHICLE_TRACK_FAILED');
  }
  return (await res.json()) as { track: ApiVehicleTrack };
}

export async function updateVehicleTrack(
  missionId: string,
  trackId: string,
  input: Partial<{
    label: string;
    vehicleType: ApiVehicleTrackVehicleType;
    origin: {
      type: 'address' | 'poi';
      query: string;
      poiId?: string;
      lng?: number;
      lat?: number;
      when?: string;
    };
    status: ApiVehicleTrackStatus;
  }>
) {
  const res = await apiFetch(
    `/missions/${encodeURIComponent(missionId)}/vehicle-tracks/${encodeURIComponent(trackId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_VEHICLE_TRACK_FAILED');
  }
  return (await res.json()) as { track: ApiVehicleTrack };
}

export async function deleteVehicleTrack(missionId: string, trackId: string) {
  const res = await apiFetch(
    `/missions/${encodeURIComponent(missionId)}/vehicle-tracks/${encodeURIComponent(trackId)}`,
    {
      method: 'DELETE',
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_VEHICLE_TRACK_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function getVehicleTrackState(
  missionId: string,
  trackId: string
): Promise<ApiVehicleTrackStateResponse> {
  const res = await apiFetch(
    `/missions/${encodeURIComponent(missionId)}/vehicle-tracks/${encodeURIComponent(trackId)}/state`
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'GET_VEHICLE_TRACK_STATE_FAILED');
  }
  return (await res.json()) as ApiVehicleTrackStateResponse;
}

export async function listMissions() {
  const res = await apiFetch('/missions');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_MISSIONS_FAILED');
  }
  return (await res.json()) as ApiMission[];
}

export async function createMission(title: string) {
  const res = await apiFetch('/missions', { method: 'POST', body: JSON.stringify({ title }) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'CREATE_MISSION_FAILED');
  }
  return (await res.json()) as ApiMission;
}

export async function clearMissionTraces(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/clear-traces`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'CLEAR_TRACES_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function deleteMission(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_MISSION_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function getMission(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'GET_MISSION_FAILED');
  }
  return (await res.json()) as ApiMission;
}

export async function updateMission(
  missionId: string,
  input: { status?: 'draft' | 'active' | 'closed'; traceRetentionSeconds?: number; title?: string }
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_MISSION_FAILED');
  }
  return (await res.json()) as ApiMission;
}

export async function listInvites() {
  const res = await apiFetch('/invites');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_INVITES_FAILED');
  }
  return (await res.json()) as ApiInvite[];
}

export async function acceptInvite(token: string) {
  const res = await apiFetch(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'ACCEPT_INVITE_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function declineInvite(token: string) {
  const res = await apiFetch(`/invites/${encodeURIComponent(token)}/decline`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DECLINE_INVITE_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function sendMissionInvite(missionId: string, invitedAppUserId: string, expiresInHours?: number) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/invites`, {
    method: 'POST',
    body: JSON.stringify({ invitedAppUserId, expiresInHours }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'SEND_INVITE_FAILED');
  }
  return (await res.json()) as {
    id: string;
    token: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    invitedUser: { id: string; appUserId: string; displayName: string };
  };
}

export async function listMissionMembers(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/members`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_MEMBERS_FAILED');
  }
  return (await res.json()) as ApiMissionMember[];
}

export async function requestMissionJoin(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/join-requests`, {
    method: 'POST',
    // Fastify rejects empty bodies when content-type is application/json,
    // so send an explicit empty JSON object.
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'REQUEST_JOIN_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function listMissionJoinRequests(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/join-requests`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_JOIN_REQUESTS_FAILED');
  }
  return (await res.json()) as ApiMissionJoinRequest[];
}

export async function acceptMissionJoinRequest(missionId: string, requestId: string) {
  const res = await apiFetch(
    `/missions/${encodeURIComponent(missionId)}/join-requests/${encodeURIComponent(requestId)}/accept`,
    {
      method: 'POST',
      // Fastify requires a non-empty JSON body when content-type is application/json.
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'ACCEPT_JOIN_REQUEST_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function acceptMissionJoinRequestWithRole(
  missionId: string,
  requestId: string,
  role: 'admin' | 'member' | 'viewer'
) {
  const res = await apiFetch(
    `/missions/${encodeURIComponent(missionId)}/join-requests/${encodeURIComponent(requestId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ role }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'ACCEPT_JOIN_REQUEST_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function updateMissionMember(
  missionId: string,
  memberUserId: string,
  input: { role?: 'admin' | 'member' | 'viewer'; color?: string }
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/members/${encodeURIComponent(memberUserId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_MEMBER_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function addMissionMemberByAppUserId(
  missionId: string,
  appUserId: string,
  role: 'admin' | 'member' | 'viewer'
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ appUserId, role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'ADD_MEMBER_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function removeMissionMember(missionId: string, memberUserId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/members/${encodeURIComponent(memberUserId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'REMOVE_MEMBER_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function declineMissionJoinRequest(missionId: string, requestId: string) {
  const res = await apiFetch(
    `/missions/${encodeURIComponent(missionId)}/join-requests/${encodeURIComponent(requestId)}/decline`,
    {
      method: 'POST',
      // Same as above: send an explicit empty JSON object.
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DECLINE_JOIN_REQUEST_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function listContacts() {
  const res = await apiFetch('/contacts');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_CONTACTS_FAILED');
  }
  return (await res.json()) as ApiContact[];
}

export async function addContact(appUserId: string, alias?: string) {
  const res = await apiFetch('/contacts', { method: 'POST', body: JSON.stringify({ appUserId, alias }) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'ADD_CONTACT_FAILED');
  }
  return (await res.json()) as ApiContact;
}

export async function updateContact(contactId: string, alias?: string) {
  const res = await apiFetch(`/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ alias }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_CONTACT_FAILED');
  }
  return (await res.json()) as { id: string; alias: string | null; createdAt: string };
}

export async function deleteContact(contactId: string) {
  const res = await apiFetch(`/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_CONTACT_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function listPois(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/pois`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_POIS_FAILED');
  }
  return (await res.json()) as ApiPoi[];
}

export async function createPoi(
  missionId: string,
  input: { type: ApiPoiType; title: string; icon: string; color: string; comment: string; lng: number; lat: number }
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/pois`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'CREATE_POI_FAILED');
  }
  return (await res.json()) as ApiPoi;
}

export async function createZone(
  missionId: string,
  input:
    | {
        type: 'circle';
        title: string;
        comment?: string;
        color: string;
        circle: { center: { lng: number; lat: number }; radiusMeters: number };
        grid?: { rows: number; cols: number; orientation?: 'vertical' | 'diag45' } | null;
      }
    | {
        type: 'polygon';
        title: string;
        comment?: string;
        color: string;
        polygon: { type: 'Polygon'; coordinates: number[][][] };
        grid?: { rows: number; cols: number; orientation?: 'vertical' | 'diag45' } | null;
      }
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/zones`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'CREATE_ZONE_FAILED');
  }
  return (await res.json()) as ApiZone;
}

export async function listZones(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/zones`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'LIST_ZONES_FAILED');
  }
  return (await res.json()) as ApiZone[];
}

export async function getPersonCase(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/person-case`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'GET_PERSON_CASE_FAILED');
  }
  return (await res.json()) as { case: ApiPersonCase | null };
}

export async function upsertPersonCase(
  missionId: string,
  input: {
    lastKnown: { type: 'address' | 'poi'; query: string; poiId?: string; lng?: number; lat?: number; when?: string };
    nextClue?: { type: 'address' | 'poi'; query: string; poiId?: string; lng?: number; lat?: number; when?: string };
    mobility: 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car';
    age?: number;
    sex: 'unknown' | 'female' | 'male';
    healthStatus: 'stable' | 'fragile' | 'critique';
    diseases?: string[];
    injuries?: { id: string; locations?: string[] }[];
    diseasesFreeText?: string;
    injuriesFreeText?: string;
  }
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/person-case`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPSERT_PERSON_CASE_FAILED');
  }
  return (await res.json()) as { case: ApiPersonCase };
}

export async function deletePersonCase(missionId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/person-case`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_PERSON_CASE_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function deletePoi(missionId: string, poiId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/pois/${encodeURIComponent(poiId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_POI_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function updatePoi(
  missionId: string,
  poiId: string,
  input: Partial<{ type: ApiPoiType; title: string; icon: string; color: string; comment: string; lng: number; lat: number }>
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/pois/${encodeURIComponent(poiId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_POI_FAILED');
  }
  return (await res.json()) as ApiPoi;
}

export async function deleteZone(missionId: string, zoneId: string) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/zones/${encodeURIComponent(zoneId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_ZONE_FAILED');
  }
  return (await res.json()) as { ok: true };
}

export async function updateZone(
  missionId: string,
  zoneId: string,
  input: Partial<{
    title: string;
    comment: string;
    color: string;
    type: 'circle' | 'polygon';
    circle: any;
    polygon: any;
    sectors: any;
    grid: { rows: number; cols: number; orientation?: 'vertical' | 'diag45' } | null;
  }>
) {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/zones/${encodeURIComponent(zoneId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'UPDATE_ZONE_FAILED');
  }
  return (await res.json()) as ApiZone;
}
