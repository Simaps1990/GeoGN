import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase, UserLocation, LocationTrail, Zone } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { MapPin, Navigation, Square, LogOut, Trash2 } from 'lucide-react';

const USER_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
];

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const trailsRef = useRef<Map<string, L.Polyline>>(new Map());
  const zonesRef = useRef<Map<string, L.Polygon>>(new Map());

  const [isTracking, setIsTracking] = useState(false);
  const [isCreatingZone, setIsCreatingZone] = useState(false);
  const [zonePoints, setZonePoints] = useState<[number, number][]>([]);
  const [zoneName, setZoneName] = useState('');
  const [showZoneDialog, setShowZoneDialog] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const userColorRef = useRef<string>(USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]);

  const { user, signOut } = useAuth();

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([48.8566, 2.3522], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    if (isCreatingZone) {
      map.on('click', (e) => {
        setZonePoints(prev => [...prev, [e.latlng.lat, e.latlng.lng]]);
      });
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (isCreatingZone) {
      mapInstanceRef.current.on('click', handleMapClick);
    } else {
      mapInstanceRef.current.off('click', handleMapClick);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off('click', handleMapClick);
      }
    };
  }, [isCreatingZone]);

  const handleMapClick = (e: L.LeafletMouseEvent) => {
    setZonePoints(prev => [...prev, [e.latlng.lat, e.latlng.lng]]);
  };

  useEffect(() => {
    if (!mapInstanceRef.current || zonePoints.length < 2) return;

    const tempPolygon = L.polygon(zonePoints, {
      color: '#3B82F6',
      fillColor: '#3B82F6',
      fillOpacity: 0.2,
    }).addTo(mapInstanceRef.current);

    return () => {
      tempPolygon.remove();
    };
  }, [zonePoints]);

  useEffect(() => {
    loadZones();
    loadUserLocations();
    loadTrails();

    const locationsChannel = supabase
      .channel('user_locations_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_locations' },
        () => { loadUserLocations(); }
      )
      .subscribe();

    const trailsChannel = supabase
      .channel('trails_changes')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'location_trails' },
        () => { loadTrails(); }
      )
      .subscribe();

    const zonesChannel = supabase
      .channel('zones_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'zones' },
        () => { loadZones(); }
      )
      .subscribe();

    return () => {
      locationsChannel.unsubscribe();
      trailsChannel.unsubscribe();
      zonesChannel.unsubscribe();
    };
  }, []);

  const loadZones = async () => {
    const { data, error } = await supabase
      .from('zones')
      .select('*');

    if (error) {
      console.error('Error loading zones:', error);
      return;
    }

    if (!mapInstanceRef.current || !data) return;

    zonesRef.current.forEach(zone => zone.remove());
    zonesRef.current.clear();

    data.forEach((zone: Zone) => {
      try {
        const coords = JSON.parse(zone.geometry.replace('SRID=4326;', '').replace('POLYGON((', '[').replace('))', ']').replace(/(\d+\.?\d*) (\d+\.?\d*)/g, '[$2,$1]'));

        const polygon = L.polygon(coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.2,
        }).addTo(mapInstanceRef.current!);

        polygon.bindPopup(`<strong>${zone.name}</strong><br>${zone.description || ''}`);
        zonesRef.current.set(zone.id, polygon);
      } catch (e) {
        console.error('Error parsing zone geometry:', e);
      }
    });
  };

  const loadUserLocations = async () => {
    const { data, error } = await supabase
      .from('user_locations')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Error loading locations:', error);
      return;
    }

    if (!mapInstanceRef.current || !data) return;

    const currentUserIds = new Set(data.map(loc => loc.user_id));

    markersRef.current.forEach((marker, userId) => {
      if (!currentUserIds.has(userId)) {
        marker.remove();
        markersRef.current.delete(userId);
      }
    });

    data.forEach((location: UserLocation) => {
      const isCurrentUser = location.user_id === user?.id;

      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background: ${isCurrentUser ? userColorRef.current : '#6B7280'}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      if (markersRef.current.has(location.user_id)) {
        const marker = markersRef.current.get(location.user_id)!;
        marker.setLatLng([location.latitude, location.longitude]);
      } else {
        const marker = L.marker([location.latitude, location.longitude], { icon })
          .addTo(mapInstanceRef.current!);
        markersRef.current.set(location.user_id, marker);
      }
    });
  };

  const loadTrails = async () => {
    const { data, error } = await supabase
      .from('location_trails')
      .select('*')
      .order('recorded_at', { ascending: true });

    if (error) {
      console.error('Error loading trails:', error);
      return;
    }

    if (!mapInstanceRef.current || !data) return;

    trailsRef.current.forEach(trail => trail.remove());
    trailsRef.current.clear();

    const trailsByUser = data.reduce((acc: any, trail: LocationTrail) => {
      if (!acc[trail.user_id]) acc[trail.user_id] = [];
      acc[trail.user_id].push([trail.latitude, trail.longitude]);
      return acc;
    }, {});

    Object.entries(trailsByUser).forEach(([userId, points]: [string, any]) => {
      const isCurrentUser = userId === user?.id;
      const polyline = L.polyline(points, {
        color: isCurrentUser ? userColorRef.current : '#6B7280',
        weight: 4,
        opacity: 0.7,
      }).addTo(mapInstanceRef.current!);

      trailsRef.current.set(userId, polyline);
    });
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      alert('La géolocalisation n\'est pas supportée par votre navigateur');
      return;
    }

    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;

        const { error } = await supabase
          .from('user_locations')
          .upsert({
            user_id: user!.id,
            latitude,
            longitude,
            accuracy,
            heading,
            speed,
            is_active: true,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          });

        if (error) {
          console.error('Error updating location:', error);
          return;
        }

        await supabase
          .from('location_trails')
          .insert({
            user_id: user!.id,
            latitude,
            longitude,
            trail_color: userColorRef.current,
          });

        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([latitude, longitude]);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('Erreur de géolocalisation: ' + error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000,
      }
    );
  };

  const stopTracking = async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    await supabase
      .from('user_locations')
      .update({ is_active: false })
      .eq('user_id', user!.id);

    setIsTracking(false);
  };

  const createZone = async () => {
    if (zonePoints.length < 3) {
      alert('Une zone doit avoir au moins 3 points');
      return;
    }

    setShowZoneDialog(true);
  };

  const saveZone = async () => {
    if (!zoneName.trim()) {
      alert('Veuillez donner un nom à la zone');
      return;
    }

    const polygonCoords = [...zonePoints, zonePoints[0]]
      .map(([lat, lng]) => `${lng} ${lat}`)
      .join(',');

    const geometry = `SRID=4326;POLYGON((${polygonCoords}))`;

    const { error } = await supabase
      .from('zones')
      .insert({
        name: zoneName,
        geometry,
        color: '#3B82F6',
        created_by: user!.id,
      });

    if (error) {
      console.error('Error creating zone:', error);
      alert('Erreur lors de la création de la zone');
      return;
    }

    setZonePoints([]);
    setZoneName('');
    setIsCreatingZone(false);
    setShowZoneDialog(false);
  };

  const clearMyTrail = async () => {
    const { error } = await supabase
      .from('location_trails')
      .delete()
      .eq('user_id', user!.id);

    if (error) {
      console.error('Error clearing trail:', error);
      return;
    }

    loadTrails();
  };

  return (
    <div className="relative w-full h-screen">
      <div ref={mapRef} className="w-full h-full" />

      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-4 space-y-3 z-[1000]">
        <div className="text-center mb-2">
          <h2 className="text-xl font-bold text-gray-900">GeoGN</h2>
          <p className="text-xs text-gray-600">{user?.email}</p>
        </div>

        <button
          onClick={isTracking ? stopTracking : startTracking}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            isTracking
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <Navigation size={18} />
          {isTracking ? 'Arrêter' : 'Démarrer'} le suivi
        </button>

        <button
          onClick={() => {
            if (isCreatingZone) {
              createZone();
            } else {
              setIsCreatingZone(true);
            }
          }}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            isCreatingZone
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-800 text-white'
          }`}
        >
          <Square size={18} />
          {isCreatingZone ? 'Terminer la zone' : 'Créer une zone'}
        </button>

        {isCreatingZone && zonePoints.length > 0 && (
          <button
            onClick={() => {
              setZonePoints([]);
              setIsCreatingZone(false);
            }}
            className="w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
          >
            Annuler
          </button>
        )}

        <button
          onClick={clearMyTrail}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
        >
          <Trash2 size={18} />
          Effacer ma trace
        </button>

        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
        >
          <LogOut size={18} />
          Déconnexion
        </button>
      </div>

      {showZoneDialog && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1001]">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Nommer la zone</h3>
            <input
              type="text"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="Nom de la zone"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={saveZone}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Créer
              </button>
              <button
                onClick={() => {
                  setShowZoneDialog(false);
                  setZoneName('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
