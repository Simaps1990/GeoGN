import { memo } from 'react';
import { AlertTriangle, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import type { ApiPersonCase } from '../lib/api';

type PersonPanelOverlayProps = {
  open: boolean;
  personPanelCollapsed: boolean;

  personEdit: boolean;
  setPersonEdit: (v: boolean) => void;
  personCase: ApiPersonCase | null;
  personLoading: boolean;
  personError: string | null;
  setPersonError: (v: string | null) => void;
  selectedMissionId: string | null;
  canEditPerson: boolean;
  setConfirmDeletePersonCaseOpen: (v: boolean) => void;
  setPersonPanelCollapsed: (v: boolean) => void;
  setPersonPanelOpen: (v: boolean) => void;

  hasActiveVehicleTrack: boolean;
  estimation: any;
  mobilityLabel: (m: any) => string;
  normalizeMobility: (m: any) => any;
  sexLabel: (s: any) => string;
  cleanDiseases: (d: any) => any;
  cleanInjuries: (i: any) => any;
  weatherLoading: boolean;
  weatherError: any;
  weather: any;
  weatherStatusLabel: (code: number | null | undefined) => string;
  formatHoursToHM: (hours: number) => string;

  personDraft: any;
  setPersonDraft: (fn: any) => void;
  lastKnownWhenInputRef: any;
  minLiveTrackWhenLocalMinute: string;
  nowLocalMinute: string;
  lastKnownSuggestionsOpen: boolean;
  setLastKnownSuggestionsOpen: (v: boolean) => void;
  lastKnownPoiSuggestions: any[];
  lastKnownAddressSuggestions: any[];
  diseasesOpen: boolean;
  setDiseasesOpen: (fn: any) => void;
  diseaseOptions: any[];
  injuriesOpen: boolean;
  setInjuriesOpen: (fn: any) => void;
  injuryOptions: any[];

  upsertPersonCase: (missionId: string, payload: any) => Promise<any>;
  setPersonCase: (v: any) => void;
  isMobilityTest: (m: any) => boolean;
  isTestTrack: (t: any) => boolean;
  createVehicleTrack: (missionId: string, payload: any) => Promise<any>;
  getVehicleTrackState: (missionId: string, trackId: string) => Promise<any>;
  setActiveVehicleTrackId: (id: string) => void;
  setVehicleTrackGeojsonById: (fn: any) => void;
  setPersonLoading: (v: boolean) => void;
};

export const PersonPanelOverlay = memo(function PersonPanelOverlay({
  open,
  personPanelCollapsed: _personPanelCollapsed,
  personEdit,
  setPersonEdit,
  personCase,
  personLoading,
  personError,
  setPersonError,
  selectedMissionId,
  canEditPerson,
  setConfirmDeletePersonCaseOpen,
  setPersonPanelCollapsed,
  setPersonPanelOpen,
  hasActiveVehicleTrack,
  estimation,
  mobilityLabel,
  normalizeMobility,
  sexLabel,
  cleanDiseases,
  cleanInjuries,
  weatherLoading,
  weatherError,
  weather,
  weatherStatusLabel,
  formatHoursToHM,
  personDraft,
  setPersonDraft,
  lastKnownWhenInputRef,
  minLiveTrackWhenLocalMinute,
  nowLocalMinute,
  lastKnownSuggestionsOpen,
  setLastKnownSuggestionsOpen,
  lastKnownPoiSuggestions,
  lastKnownAddressSuggestions,
  diseasesOpen,
  setDiseasesOpen,
  diseaseOptions,
  injuriesOpen,
  setInjuriesOpen,
  injuryOptions,
  upsertPersonCase,
  setPersonCase,
  isMobilityTest,
  isTestTrack,
  createVehicleTrack,
  getVehicleTrackState,
  setActiveVehicleTrackId,
  setVehicleTrackGeojsonById,
  setPersonLoading,
}: PersonPanelOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-[1250] flex items-center justify-center bg-black/30 p-4"
      onClick={() => setPersonPanelCollapsed(true)}
    >
      <div
        className={
          personEdit || !personCase
            ? 'w-full max-w-3xl max-h-[calc(100vh-48px)] flex flex-col rounded-3xl bg-white p-4 shadow-xl'
            : 'w-full max-w-3xl max-h-[calc(100vh-48px)] flex flex-col rounded-3xl bg-white p-4 shadow-xl'
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-bold text-gray-900">Démarrer une piste</div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {!personEdit && personCase ? (
                <button
                  type="button"
                  onClick={() => setPersonPanelCollapsed(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                  title="Réduire"
                >
                  <ChevronDown size={16} />
                </button>
              ) : null}
              {canEditPerson && !personEdit && personCase ? (
                <button
                  type="button"
                  onClick={() => {
                    setPersonPanelCollapsed(false);
                    setPersonEdit(true);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                  title="Modifier la fiche"
                >
                  <Pencil size={16} />
                </button>
              ) : null}
              {canEditPerson && !personEdit && personCase ? (
                <button
                  type="button"
                  disabled={personLoading || !selectedMissionId}
                  onClick={async () => {
                    if (!selectedMissionId || !personCase) return;
                    setConfirmDeletePersonCaseOpen(true);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                  title="Supprimer la fiche"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>

            {null}
          </div>
        </div>

        <div className="mt-3 grid flex-1 gap-3 overflow-y-auto pr-1">
          {personLoading ? <div className="text-sm text-gray-600">Chargement…</div> : null}
          {personError ? <div className="text-sm text-red-600">{personError}</div> : null}

          {!personEdit && personCase ? (
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-2xl border p-3">
                <div className="text-xs font-semibold text-gray-700">Dernier indice</div>
                <div className="mt-1 text-sm text-gray-900">
                  {personCase.lastKnown.type === 'poi' ? 'POI' : 'Adresse'}: {personCase.lastKnown.query}
                </div>
                {personCase.lastKnown.when ? (
                  <div className="mt-1 text-xs text-gray-600">Heure: {new Date(personCase.lastKnown.when).toLocaleString()}</div>
                ) : null}
                <div className="mt-1 text-xs text-gray-600">Déplacement: {mobilityLabel(personCase.mobility)}</div>
              </div>
              {normalizeMobility(personCase.mobility as any) === 'none' ? (
                <div className="rounded-2xl border p-3">
                  <div className="text-xs font-semibold text-gray-700">Profil</div>
                  <div className="mt-1 text-sm text-gray-900">
                    Âge: {personCase.age ?? '—'}
                    {' · '}Sexe: {sexLabel(personCase.sex)}
                    {' · '}État: {personCase.healthStatus}
                  </div>
                  {Array.isArray(personCase.diseases) && personCase.diseases.length ? (
                    <div className="mt-1 text-xs text-gray-600">Maladies: {personCase.diseases.join(', ')}</div>
                  ) : null}
                  {Array.isArray(personCase.injuries) && personCase.injuries.length
                    ? (() => {
                        const clean = cleanInjuries(personCase.injuries);
                        if (!clean.length) return null;
                        const labels = clean.map((inj: any) => {
                          if (inj.id === 'plaie') return 'Plaie membre inférieur';
                          return inj.id;
                        });
                        return <div className="mt-1 text-xs text-gray-600">Blessures: {labels.join(', ')}</div>;
                      })()
                    : null}
                </div>
              ) : null}

              <div className="rounded-2xl border p-3">
                <div className="text-xs font-semibold text-gray-700">Météo (sur le dernier point)</div>
                {weatherLoading ? <div className="mt-1 text-sm text-gray-600">Chargement météo…</div> : null}
                {weatherError ? <div className="mt-1 text-sm text-red-600">Météo indisponible</div> : null}
                {!weatherLoading && !weatherError && weather ? (
                  <div className="mt-1 text-sm text-gray-900">
                    {weatherStatusLabel(weather.weatherCode)}
                    {' · '}
                    {typeof weather.temperatureC === 'number' ? `${weather.temperatureC.toFixed(1)}°C` : '—'}
                    {' · '}Vent {typeof weather.windSpeedKmh === 'number' ? `${weather.windSpeedKmh.toFixed(0)} km/h` : '—'}
                  </div>
                ) : null}
              </div>

              {estimation && !hasActiveVehicleTrack ? (
                <div className="rounded-2xl border p-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-700">Estimation</div>
                  </div>
                  <div className="mt-1 text-sm text-gray-900">
                    Rayon probable: ~{estimation.probableKm.toFixed(1)} km
                    <br />
                    Max: ~{estimation.maxKm.toFixed(1)} km
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    Vitesse estimée: ~{estimation.effectiveKmh.toFixed(1)} km/h
                    {estimation.hoursSince === null ? '' : (
                      <>
                        <br />
                        Temps écoulé: {formatHoursToHM(estimation.hoursSince)}
                      </>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {estimation.needs.length ? (
                      <div>
                        <div className="text-[11px] font-semibold text-gray-600">Besoins prioritaires</div>
                        <div className="mt-1 grid gap-1">
                          {estimation.needs.map((n: string) => (
                            <div key={n} className="text-xs text-gray-700">
                              - {n}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {estimation.likelyPlaces.length ? (
                      <div>
                        <div className="text-[11px] font-semibold text-gray-600">Lieux probables</div>
                        <div className="mt-1 grid gap-1">
                          {estimation.likelyPlaces.map((p: string) => (
                            <div key={p} className="text-xs text-gray-700">
                              - {p}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : canEditPerson ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                <div className="relative min-w-0 w-full">
                  <div className="text-xs font-semibold text-gray-700">Dernière position connue</div>
                  <input
                    type="text"
                    value={personDraft.lastKnownQuery}
                    onChange={(e) =>
                      setPersonDraft((p: any) => ({
                        ...p,
                        lastKnownQuery: e.target.value,
                        lastKnownType: 'address',
                        lastKnownPoiId: undefined,
                        lastKnownLng: undefined,
                        lastKnownLat: undefined,
                      }))
                    }
                    onFocus={() => setLastKnownSuggestionsOpen(true)}
                    onBlur={() => window.setTimeout(() => setLastKnownSuggestionsOpen(false), 150)}
                    placeholder="Soit un POI soit une adresse"
                    className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                  />

                  {lastKnownSuggestionsOpen &&
                  (lastKnownPoiSuggestions.length > 0 || lastKnownAddressSuggestions.length > 0) ? (
                    <div className="absolute left-0 right-0 top-[72px] z-10 rounded-2xl border bg-white shadow">
                      {lastKnownPoiSuggestions.length > 0 ? (
                        <div className="border-b p-2">
                          <div className="px-2 pb-1 text-[11px] font-semibold text-gray-600">POI</div>
                          <div className="grid gap-1">
                            {lastKnownPoiSuggestions.map((p: any) => (
                              <button
                                key={p.id}
                                type="button"
                                className="rounded-xl px-2 py-2 text-left text-sm hover:bg-gray-50"
                                onClick={() => {
                                  setPersonDraft((prev: any) => ({
                                    ...prev,
                                    lastKnownType: 'poi',
                                    lastKnownQuery: p.title,
                                    lastKnownPoiId: p.id,
                                    lastKnownLng: p.lng,
                                    lastKnownLat: p.lat,
                                  }));
                                  setLastKnownSuggestionsOpen(false);
                                }}
                              >
                                {p.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {lastKnownAddressSuggestions.length > 0 ? (
                        <div className="p-2">
                          <div className="px-2 pb-1 text-[11px] font-semibold text-gray-600">Adresse</div>
                          <div className="grid gap-1">
                            {lastKnownAddressSuggestions.map((a: any) => (
                              <button
                                key={`${a.label}-${a.lng}-${a.lat}`}
                                type="button"
                                className="rounded-xl px-2 py-2 text-left text-sm hover:bg-gray-50"
                                onClick={() => {
                                  setPersonDraft((prev: any) => ({
                                    ...prev,
                                    lastKnownType: 'address',
                                    lastKnownQuery: a.label,
                                    lastKnownPoiId: undefined,
                                    lastKnownLng: a.lng,
                                    lastKnownLat: a.lat,
                                  }));
                                  setLastKnownSuggestionsOpen(false);
                                }}
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div
                  onClick={() => {
                    if (hasActiveVehicleTrack) return;
                    const el = lastKnownWhenInputRef.current;
                    if (!el) return;
                    // showPicker est supporté par la plupart des navigateurs modernes
                    if (typeof (el as any).showPicker === 'function') {
                      (el as any).showPicker();
                    } else {
                      el.focus();
                    }
                  }}
                  className="cursor-pointer min-w-0 w-full"
                >
                  <div className="text-xs font-semibold text-gray-700">Date / heure</div>
                  <input
                    ref={lastKnownWhenInputRef}
                    type="datetime-local"
                    value={personDraft.lastKnownWhen}
                    min={minLiveTrackWhenLocalMinute}
                    max={nowLocalMinute}
                    disabled={hasActiveVehicleTrack}
                    onChange={(e) =>
                      setPersonDraft((p: any) => ({
                        ...p,
                        lastKnownWhen: e.target.value,
                      }))
                    }
                    className="mt-1 h-10 w-full max-w-full min-w-0 rounded-2xl border px-3 text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-600">
                    <AlertTriangle size={12} className="text-amber-600" />
                    <span>Durée de piste en live 2h max et possibilité de revenir 12h en arriere max.</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700">Mode de déplacement</div>
                <select
                  value={personDraft.mobility}
                  onChange={(e) => setPersonDraft((p: any) => ({ ...p, mobility: e.target.value as any }))}
                  className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                >
                  <option value="none">À pied</option>
                  <option value="bike_test">Vélo</option>
                  <option value="scooter_test">Scooter</option>
                  <option value="motorcycle_test">Moto</option>
                  <option value="car_test">Voiture</option>
                  <option value="truck_test">Camion</option>
                </select>
              </div>
              {normalizeMobility(personDraft.mobility as any) === 'none' ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-xs font-semibold text-gray-700">Âge</div>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        value={personDraft.age}
                        onChange={(e) => setPersonDraft((p: any) => ({ ...p, age: e.target.value }))}
                        className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-700">Sexe</div>
                      <select
                        value={personDraft.sex}
                        onChange={(e) => setPersonDraft((p: any) => ({ ...p, sex: e.target.value as any }))}
                        className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                      >
                        <option value="unknown">Inconnu</option>
                        <option value="female">Femme</option>
                        <option value="male">Homme</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-700">État</div>
                      <select
                        value={personDraft.healthStatus}
                        onChange={(e) => setPersonDraft((p: any) => ({ ...p, healthStatus: e.target.value as any }))}
                        className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                      >
                        <option value="stable">Stable</option>
                        <option value="fragile">Fragile</option>
                        <option value="critique">Critique</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="rounded-2xl border p-3 md:flex-1">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setDiseasesOpen((v: boolean) => !v)}
                      >
                        <div className="text-xs font-semibold text-gray-700">Maladies connues</div>
                        <span className="text-xs text-gray-500">{diseasesOpen ? 'Masquer' : 'Afficher'}</span>
                      </button>
                      {diseasesOpen ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {diseaseOptions.map((id: any) => {
                            const checked = personDraft.diseases.includes(id);
                            const raw = id.replace(/_/g, ' ');
                            const label = raw.replace(/\b\w/g, (c: string) => c.toUpperCase());
                            return (
                              <div key={id} className="rounded-2xl border p-2">
                                <label className="flex items-center gap-2 text-sm text-gray-800">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? Array.from(new Set([...personDraft.diseases, id]))
                                        : personDraft.diseases.filter((x: any) => x !== id);
                                      setPersonDraft((p: any) => ({ ...p, diseases: next }));
                                    }}
                                  />
                                  <span className="font-normal">{label}</span>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border p-3 md:flex-1">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setInjuriesOpen((v: boolean) => !v)}
                      >
                        <div className="text-xs font-semibold text-gray-700">Blessures</div>
                        <span className="text-xs text-gray-500">{injuriesOpen ? 'Masquer' : 'Afficher'}</span>
                      </button>
                      {injuriesOpen ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {injuryOptions.map((injuryId: any) => {
                            const injury = personDraft.injuries.find((x: any) => x.id === injuryId);
                            const checked = !!injury;
                            return (
                              <div key={injuryId} className="rounded-2xl border p-2">
                                <label className="flex items-center gap-2 text-sm text-gray-800">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setPersonDraft((p: any) => ({
                                          ...p,
                                          injuries: [...p.injuries, { id: injuryId, locations: [] }],
                                        }));
                                      } else {
                                        setPersonDraft((p: any) => ({
                                          ...p,
                                          injuries: p.injuries.filter((x: any) => x.id !== injuryId),
                                        }));
                                      }
                                    }}
                                  />
                                  <span className="font-normal">
                                    {injuryId.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                  </span>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={personLoading}
                  onClick={() => {
                    if (personCase) {
                      setPersonEdit(false);
                      const last = personCase.lastKnown;
                      const cleanDis = cleanDiseases(personCase.diseases ?? []);
                      const cleanInj = cleanInjuries(personCase.injuries ?? []);
                      setPersonDraft({
                        lastKnownQuery: last.query,
                        lastKnownType: last.type,
                        lastKnownPoiId: last.poiId,
                        lastKnownLng: typeof last.lng === 'number' ? last.lng : undefined,
                        lastKnownLat: typeof last.lat === 'number' ? last.lat : undefined,
                        lastKnownWhen: last.when ? last.when.slice(0, 16) : '',
                        mobility: personCase.mobility,
                        age: typeof personCase.age === 'number' ? String(personCase.age) : '',
                        sex: personCase.sex ?? 'unknown',
                        healthStatus: personCase.healthStatus ?? 'stable',
                        diseases: cleanDis,
                        diseasesFreeText: personCase.diseasesFreeText ?? '',
                        injuries: cleanInj.map((x: any) => ({
                          id: x.id,
                          locations: x.locations,
                        })),
                        injuriesFreeText: personCase.injuriesFreeText ?? '',
                      });
                    } else {
                      setPersonPanelOpen(false);
                    }
                  }}
                  className="h-11 rounded-2xl border bg-white text-sm font-semibold text-gray-700 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={
                    personLoading ||
                    !selectedMissionId ||
                    !personDraft.lastKnownWhen ||
                    !(personDraft.lastKnownQuery ?? '').trim() ||
                    !personDraft.mobility
                  }
                  onClick={async () => {
                    if (!selectedMissionId) return;

                    const address = (personDraft.lastKnownQuery ?? '').trim();
                    if (!address) {
                      setPersonError('Adresse requise');
                      return;
                    }
                    if (!personDraft.lastKnownWhen) {
                      setPersonError('Date / heure requise');
                      return;
                    }

                    try {
                      const dt = new Date(personDraft.lastKnownWhen);
                      if (!Number.isNaN(dt.getTime()) && dt.getTime() > Date.now()) {
                        setPersonError("Date / heure ne peut pas être dans le futur");
                        return;
                      }
                    } catch {
                      // ignore
                    }
                    if (!personDraft.mobility) {
                      setPersonError('Mode de déplacement requis');
                      return;
                    }

                    setPersonLoading(true);
                    setPersonError(null);
                    try {
                      const ageTrimmed = personDraft.age.trim();
                      const ageParsed = ageTrimmed ? Number(ageTrimmed) : undefined;
                      const mobilityUi = personDraft.mobility as any;
                      const mobility = normalizeMobility(mobilityUi);
                      const payload = {
                        lastKnown: {
                          type: personDraft.lastKnownType,
                          query: address,
                          poiId: personDraft.lastKnownPoiId,
                          lng: personDraft.lastKnownLng,
                          lat: personDraft.lastKnownLat,
                          when: personDraft.lastKnownWhen
                            ? new Date(personDraft.lastKnownWhen).toISOString()
                            : undefined,
                        },
                        mobility,
                        age: Number.isFinite(ageParsed as any) ? Math.floor(ageParsed as number) : undefined,
                        sex: personDraft.sex,
                        healthStatus: personDraft.healthStatus,
                        diseases: cleanDiseases(personDraft.diseases) as string[],
                        injuries: cleanInjuries(personDraft.injuries) as any,
                        diseasesFreeText: personDraft.diseasesFreeText,
                        injuriesFreeText: personDraft.injuriesFreeText,
                      };

                      const saved = await upsertPersonCase(selectedMissionId, payload);
                      setPersonCase(saved.case);
                      setPersonEdit(false);

                      if (isMobilityTest(mobilityUi) && canEditPerson) {
                        const whenIso = personDraft.lastKnownWhen
                          ? new Date(personDraft.lastKnownWhen).toISOString()
                          : undefined;
                        const vehicleType =
                          mobilityUi === 'motorcycle_test'
                            ? 'motorcycle'
                            : mobilityUi === 'scooter_test'
                              ? 'scooter'
                              : mobilityUi === 'bike_test'
                                ? 'motorcycle'
                                : mobilityUi === 'truck_test'
                                  ? 'truck'
                                  : 'car';
                        try {
                          const created = await createVehicleTrack(selectedMissionId, {
                            label:
                              mobilityUi === 'motorcycle_test'
                                ? 'Moto'
                                : mobilityUi === 'scooter_test'
                                    ? 'Scooter'
                                    : mobilityUi === 'bike_test'
                                      ? 'Vélo'
                                      : mobilityUi === 'truck_test'
                                        ? 'Camion'
                                        : 'Voiture',
                            vehicleType: vehicleType as any,
                            origin: {
                              type: personDraft.lastKnownType,
                              query: address,
                              poiId: personDraft.lastKnownPoiId,
                              lng: personDraft.lastKnownLng,
                              lat: personDraft.lastKnownLat,
                              when: whenIso,
                            },
                            algorithm: 'road_graph',
                          });

                          const createdTrack = created.track;
                          if (createdTrack && createdTrack.id) {
                            setActiveVehicleTrackId(createdTrack.id);
                            try {
                              const state = await getVehicleTrackState(selectedMissionId, createdTrack.id);
                              if (state.cache?.payloadGeojson) {
                                const provider = (state.cache.meta as any)?.provider as string | undefined;
                                const isTest = isTestTrack(createdTrack as any);
                                const allowTomtom =
                                  provider === 'tomtom_reachable_range' ||
                                  provider === 'tomtom_reachable_range_fallback_circle';
                                if (!isTest || allowTomtom) {
                                  setVehicleTrackGeojsonById((prev: any) => ({
                                    ...prev,
                                    [createdTrack.id]: state.cache!.payloadGeojson as any,
                                  }));
                                }
                              }
                            } catch {
                              // ignore state loading error
                            }
                          }
                        } catch {
                          // création de piste non bloquante pour la fiche personne
                        }
                      }
                    } catch (e: any) {
                      setPersonError(e?.message ?? 'Erreur');
                    } finally {
                      setPersonLoading(false);
                    }
                  }}
                  className="h-11 rounded-2xl bg-blue-600 text-sm font-semibold text-white shadow disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border p-3">
              <div className="text-sm font-semibold text-gray-900">Aucune fiche personne</div>
              <div className="mt-1 text-sm text-gray-600">Vous avez un accès en lecture seule.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
