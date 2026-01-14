export interface Zone {
  id: string;
  name: string;
  description: string | null;
  geometry: any;
  color: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface UserLocation {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  is_active: boolean;
  updated_at: string;
}

export interface LocationTrail {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  trail_color: string;
}
