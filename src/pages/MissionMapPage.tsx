import { ArrowLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MapLibreMap from '../components/MapLibreMap';

type AddressFeature = {
  properties?: {
    label?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
};

export default function MissionMapPage() {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressFeature[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [zoneDraftActive, setZoneDraftActive] = useState(false);
  const [zoneDraftTool, setZoneDraftTool] = useState<'none' | 'poi' | 'zone_circle' | 'zone_polygon'>('none');
  const [circleRadiusReady, setCircleRadiusReady] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState(0);

  const trimmed = query.trim();
  const shouldSearch = useMemo(() => trimmed.length >= 3, [trimmed.length]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (!shouldSearch) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const t = window.setTimeout(async () => {
      try {
        const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(trimmed)}&limit=6`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        const feats = Array.isArray(data?.features) ? (data.features as AddressFeature[]) : [];
        setResults(feats);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [trimmed, shouldSearch]);

  useEffect(() => {
    const onDraft = (e: any) => {
      const d = e?.detail;
      setZoneDraftActive(!!d?.active);
      setZoneDraftTool((d?.activeTool as any) ?? 'none');
      setCircleRadiusReady(!!d?.circleRadiusReady);
      setPolygonPoints(typeof d?.polygonPoints === 'number' ? d.polygonPoints : 0);
      if (d?.active) {
        setOpen(false);
        setFocused(false);
      }
    };
    window.addEventListener('geogn:zone:draftState', onDraft as any);
    return () => {
      window.removeEventListener('geogn:zone:draftState', onDraft as any);
    };
  }, []);

  return (
    <div className="relative">
      <div
        className="fixed left-4 right-20 top-[calc(env(safe-area-inset-top)+16px)] z-[1200] flex items-center gap-3"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => navigate('/home')}
          className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Retour"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="relative flex-1 max-w-xl">
          {zoneDraftActive && (zoneDraftTool === 'zone_circle' || zoneDraftTool === 'zone_polygon') ? (
            <div className="flex h-12 items-center justify-center gap-2 px-2">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('geogn:zone:draftCancel'));
                }}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-b from-red-500/90 to-red-400/90 px-5 text-sm font-semibold text-white shadow-sm hover:from-red-500 hover:to-red-400"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={zoneDraftTool === 'zone_circle' ? !circleRadiusReady : polygonPoints < 3}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('geogn:zone:draftValidate'));
                }}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-b from-emerald-500/90 to-emerald-400/90 px-5 text-sm font-semibold text-white shadow-sm hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-100 disabled:from-emerald-500/90 disabled:to-emerald-400/90"
              >
                Valider
              </button>
            </div>
          ) : (
            <>
              <div
                className={`flex h-12 items-center gap-2 rounded-2xl border bg-white/90 px-3 shadow backdrop-blur transition-opacity ${
                  focused ? 'opacity-100' : 'opacity-50'
                }`}
              >
                <Search size={18} className="text-gray-500" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                  }}
                  onFocus={() => {
                    setFocused(true);
                    setOpen(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setFocused(false);
                      setOpen(false);
                    }, 150);
                  }}
                  placeholder="Rechercher une adresse"
                  className="h-full w-full bg-transparent text-sm outline-none"
                  autoComplete="off"
                />
                {loading ? <div className="text-[11px] text-gray-500">...</div> : null}
              </div>

              {open && results.length ? (
                <div className="absolute left-0 right-0 mt-2 overflow-hidden rounded-2xl border bg-white shadow">
                  {results.map((f, idx) => {
                    const label = f?.properties?.label || 'Adresse';
                    return (
                      <button
                        key={`${label}-${idx}`}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const c = f?.geometry?.coordinates;
                          if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
                          setQuery(label);
                          setOpen(false);
                          window.dispatchEvent(
                            new CustomEvent('geogn:map:flyTo', {
                              detail: { lng: c[0], lat: c[1], zoom: 17 },
                            })
                          );
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <MapLibreMap />
    </div>
  );
}
