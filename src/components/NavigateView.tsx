import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, Navigation, MapPin, Search, X, ArrowRight, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// @ts-ignore - Mapbox GL JS types
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

interface GeocodingFeature {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
  context?: Array<{ id: string; text: string }>;
}

interface Maneuver {
  instruction: string;
  distance: number;
  duration: number;
  type: string;
  modifier?: string;
  way_name?: string;
}

interface RouteState {
  isNavigating: boolean;
  origin: [number, number] | null;
  destination: GeocodingFeature | null;
  routeGeometry: GeoJSON.LineString | null;
  maneuvers: Maneuver[];
  currentStepIndex: number;
  eta: number;
  distance: number;
  steps: number;
  safetyScore: number;
  safetyLabel: string;
  hazardWarnings: { name: string; severity: string; distanceKm: number }[];
  maneuverCoords: [number, number][];
}

const MANEUVER_ICONS: Record<string, string> = {
  depart: '🚀', turn: '↩️', merge: '↗️', 'on ramp': '🛣️',
  'off ramp': '↘️', fork: '↗️', 'end of road': '↩️',
  continue: '➡️', 'new name': '➡️', destination: '🏁',
  'destination reached': '✅', 'rotary': '🔄', 'roundabout': '🔄',
};

const DIRECTION_SUFFIX: Record<string, string> = {
  right: ' ke kanan', left: ' ke kiri',
  'slight right': ' sedikit ke kanan', 'slight left': ' sedikit ke kiri',
  sharp: ' tajam', straight: ' terus',
};

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} menit`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}j ${rem}m` : `${hours} jam`;
}

function translateManeuver(instruction: string, modifier?: string): string {
  const lower = instruction.toLowerCase();
  let suffix = modifier ? (DIRECTION_SUFFIX[modifier.toLowerCase()] || '') : '';
  if (lower.includes('depart')) return 'Mulai perjalanan';
  if (lower.includes('destination reached')) return 'Anda telah tiba';
  if (lower.includes('continue')) return 'Terus' + suffix;
  if (lower.includes('turn')) return `Belok${suffix}`;
  if (lower.includes('slight right')) return 'Belok sedikit kanan';
  if (lower.includes('slight left')) return 'Belok sedikit kiri';
  if (lower.includes('sharp right')) return 'Belok tajam kanan';
  if (lower.includes('sharp left')) return 'Belok tajam kiri';
  if (lower.includes('right')) return 'Belok kanan';
  if (lower.includes('left')) return 'Belok kiri';
  if (lower.includes('straight')) return 'Terus';
  if (lower.includes('merge')) return 'Bergabung' + suffix;
  if (lower.includes('ramp')) return 'Masuk jalan bebas hambatan' + suffix;
  if (lower.includes('roundabout') || lower.includes('rotary')) return 'Masuk bundaran';
  return instruction;
}

export default function NavigateView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const currentLocationRef = useRef<[number, number]>([107.3371, -6.3065]);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [hazards, setHazards] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const isCalculatingRouteRef = useRef(false);

  const [routeProfile, setRouteProfile] = useState<'driving' | 'driving-traffic' | 'cycling' | 'walking'>('driving-traffic');

  const [routeState, setRouteState] = useState<RouteState>({
    isNavigating: false, origin: null, destination: null, routeGeometry: null,
    maneuvers: [], currentStepIndex: 0, eta: 0, distance: 0, steps: 0,
    safetyScore: 100, safetyLabel: 'Sangat Aman', hazardWarnings: [], maneuverCoords: [],
  });

  const [currentLocation, setCurrentLocation] = useState<[number, number]>([107.3371, -6.3065]);
  const [locationStatus, setLocationStatus] = useState<'loading' | 'success' | 'error' | null>(null);
  const [locationErrorMsg, setLocationErrorMsg] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [activeTab, setActiveTab] = useState<'map' | 'search' | 'camera'>('map');
  const userLocationMarker = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => { currentLocationRef.current = currentLocation; }, [currentLocation]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('your_mapbox_token')) {
      setTokenError('Mapbox token tidak ditemukan. Set VITE_MAPBOX_ACCESS_TOKEN di .env'); return;
    }
    if (!MAPBOX_TOKEN.startsWith('pk.')) { setTokenError('Token Mapbox harus dimulai dengan "pk."'); return; }
  }, []);

  useEffect(() => {
    const updateClock = () => setCurrentTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isCameraActive) startCamera(); else stopCamera();
  }, [isCameraActive]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) { console.error("Camera access failed", err); }
  }

  function stopCamera() {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
  }

  async function scanRoad() {
    if (!videoRef.current || !isCameraActive) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const base64Image = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
        const response = await fetch('/api/analyze-road', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64Image, location: { lat: currentLocation[1], lng: currentLocation[0] } }),
        });
        if (response.ok) {
          const result = await response.json();
          if (result.hazardDetected) {
            const newHazard = {
              id: Date.now(), type: result.type || "Bahaya Jalan", distance: "dekat",
              severityColor: result.severity === 'high' ? "text-red-500" : "text-brand-orange",
            };
            setHazards(prev => [newHazard, ...prev].slice(0, 3));
            window.speechSynthesis?.speak(new SpeechSynthesisUtterance(`Waspada di depan: ${result.description || result.type}`));
          }
        }
      }
    } catch (err) { console.warn("AI scanning error", err); }
  }

  useEffect(() => {
    if (!isCameraActive) return;
    const interval = setInterval(scanRoad, 5000);
    return () => clearInterval(interval);
  }, [isCameraActive, currentLocation]);

  const fetchLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocationStatus('error'); setLocationErrorMsg('Geolocation tidak didukung browser ini'); return; }
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude, lat = pos.coords.latitude;
        const isInIndonesia = lng >= 95 && lng <= 141 && lat >= -11 && lat <= 6;
        const finalLocation: [number, number] = isInIndonesia ? [lng, lat] : [107.3371, -6.3065];
        setCurrentLocation(finalLocation);
        setLocationStatus(isInIndonesia ? 'success' : 'error');
        setLocationErrorMsg(isInIndonesia ? '' : 'Lokasi terdeteksi di luar Indonesia. Menggunakan Karawang sebagai default.');
        if (mapInstanceRef.current) mapInstanceRef.current.flyTo({ center: finalLocation, zoom: 14 });
      },
      (err) => {
        setLocationStatus('error');
        setLocationErrorMsg(
          err.code === 1 ? 'Izin lokasi ditolak. Aktifkan lokasi di pengaturan browser.' :
          err.code === 2 ? 'Lokasi tidak tersedia. Pastikan GPS aktif.' :
          err.code === 3 ? 'Timeout mencari lokasi. Coba lagi.' : 'Gagal mendapatkan lokasi.'
        );
        setCurrentLocation([107.3371, -6.3065]);
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 300000 }
    );
  }, []);

  useEffect(() => { fetchLocation(); }, [fetchLocation]);

  useEffect(() => {
    if (tokenError || mapInstanceRef.current || !mapContainerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN!;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current!,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: currentLocation, zoom: 14, attributionControl: false,
    });

    map.on('load', () => {
      const el = document.createElement('div');
      el.className = 'user-location-pulse';
      el.style.cssText = `
        width:20px;height:20px;background:#94a3b8;border-radius:50%;border:3px solid white;
        box-shadow:0 0 0 0 rgba(148,163,184,0.4);animation:pulse 2s infinite;transition:background 0.3s ease;
      `;
      const style = document.createElement('style');
      style.textContent = `@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4);}70%{box-shadow:0 0 0 12px rgba(59,130,246,0);}100%{box-shadow:0 0 0 0 rgba(59,130,246,0);}}`;
      document.head.appendChild(style);
      userLocationMarker.current = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(currentLocation).addTo(map);

      navigator.geolocation?.watchPosition((pos) => {
        const [lng, lat] = [pos.coords.longitude, pos.coords.latitude];
        setCurrentLocation([lng, lat]);
        userLocationMarker.current?.setLngLat([lng, lat]);
        setRouteState(prev => {
          if (!prev.isNavigating || prev.maneuverCoords.length === 0) return prev;
          const nextIdx = prev.currentStepIndex + 1;
          if (nextIdx >= prev.maneuverCoords.length) return prev;
          const dist = haversineM([lng, lat], prev.maneuverCoords[nextIdx]);
          if (dist <= 50) {
            const afterNext = prev.maneuvers[nextIdx + 1];
            if (afterNext) {
              const u = new SpeechSynthesisUtterance(translateManeuver(afterNext.instruction, afterNext.modifier));
              u.lang = 'id-ID'; u.rate = 1.1; window.speechSynthesis?.speak(u);
            }
            return { ...prev, currentStepIndex: nextIdx };
          }
          return prev;
        });
      });
    });
    mapInstanceRef.current = map;
    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [tokenError]);

  useEffect(() => {
    const markerEl = userLocationMarker.current?.getElement();
    if (!markerEl) return;
    if (locationStatus === 'loading') { markerEl.style.background = '#94a3b8'; markerEl.style.animation = 'pulse 1s infinite'; }
    else if (locationStatus === 'success') { markerEl.style.background = '#3b82f6'; markerEl.style.animation = 'pulse 2s infinite'; userLocationMarker.current?.setLngLat(currentLocation); }
    else if (locationStatus === 'error') { markerEl.style.background = '#ef4444'; markerEl.style.animation = 'none'; }
  }, [locationStatus, currentLocation]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !routeState.routeGeometry) return;
    const sourceId = 'route-source', layerId = 'route-layer';
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    map.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', geometry: routeState.routeGeometry, properties: {} } });
    map.addLayer({ id: layerId, type: 'line', source: sourceId, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f97316', 'line-width': 5, 'line-opacity': 0.8 } });
    const coords = routeState.routeGeometry.coordinates;
    if (coords.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      coords.forEach(c => bounds.extend([c[0], c[1]] as [number, number]));
      map.fitBounds(bounds, { padding: 80, duration: 1000 });
    }
    return () => { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); };
  }, [routeState.routeGeometry]);

  const searchPlaces = useCallback(async (query: string) => {
    if (!query.trim()) { setSuggestions([]); return; }
    setSearchLoading(true); setSearchError('');
    try {
      const proximity = `${currentLocationRef.current[0]},${currentLocationRef.current[1]}`;
      const res = await fetch(`/api/geocode?query=${encodeURIComponent(query)}&proximity=${proximity}`);
      const data = await res.json();
      if (data.error && !data.features) { setSearchError(data.error); setSuggestions([]); return; }
      if (data.features?.length > 0) { setSuggestions(data.features as GeocodingFeature[]); }
      else { setSuggestions([]); setSearchError('Tidak ada hasil ditemukan. Coba kata kunci lain.'); }
    } catch { setSearchError('Gagal mencari lokasi. Cek koneksi internet.'); setSuggestions([]); }
    finally { setSearchLoading(false); }
  }, []);

  useEffect(() => {
    if (isCalculatingRouteRef.current) { isCalculatingRouteRef.current = false; return; }
    const timer = setTimeout(() => { if (searchQuery.trim()) searchPlaces(searchQuery); }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchPlaces]);

  async function calculateRoute(dest: GeocodingFeature) {
    isCalculatingRouteRef.current = true;
    setSearchQuery(dest.place_name); setSearchError('');
    const origin: [number, number] = currentLocation;
    const destination: [number, number] = dest.center;
    const distance = Math.sqrt(Math.pow((destination[0] - origin[0]) * 111, 2) + Math.pow((destination[1] - origin[1]) * 111, 2));
    if (distance > 100) { setSearchError(`Jarak terlalu jauh (${distance.toFixed(0)}km). Mapbox free tier maksimal 100km.`); return; }

    try {
      const res = await fetch('/api/directions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, profile: routeProfile }),
      });
      if (!res.ok) {
        const err = await res.json();
        setSearchError(err.error?.includes('maximum distance') ? 'Jarak terlalu jauh untuk rute gratis. Pilih lokasi dalam radius 100km.' : (err.error || 'Gagal menghitung rute'));
        return;
      }
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const steps = data.routes[0].legs?.[0]?.steps || [];
        const maneuverCoords: [number, number][] = steps.map((step: any) => {
          const loc = step.maneuver?.location ?? step.location ?? step.intersections?.[0]?.location ?? null;
          return (loc ? [loc[0], loc[1]] : currentLocation) as [number, number];
        });
        setRouteState({
          isNavigating: false, origin, destination: dest, routeGeometry: route.geometry,
          maneuvers: steps, currentStepIndex: 0,
          eta: Math.round(route.duration / 60), distance: Math.round(route.distance), steps: steps.length,
          safetyScore: route.safetyScore ?? 100, safetyLabel: data.safetySummary?.label ?? 'Sangat Aman',
          hazardWarnings: route.hazardWarnings ?? [], maneuverCoords,
        });
      } else { setSearchError('Rute tidak ditemukan'); }
    } catch (err: any) { setSearchError(err.message || 'Gagal menghitung rute'); }
  }

  function haversineM(a: [number, number], b: [number, number]): number {
    const R = 6371000, dLat = (b[1] - a[1]) * Math.PI / 180, dLon = (b[0] - a[0]) * Math.PI / 180;
    const lat1 = a[1] * Math.PI / 180, lat2 = b[1] * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function startNavigation() { setRouteState(prev => ({ ...prev, isNavigating: true })); setIsCameraActive(true); }
  function cancelNavigation() {
    setRouteState(prev => ({ ...prev, isNavigating: false, currentStepIndex: 0 }));
    setIsCameraActive(false); setHazards([]); window.speechSynthesis?.cancel();
  }
  function resetRoute() {
    cancelNavigation();
    setRouteState({ isNavigating: false, origin: null, destination: null, routeGeometry: null, maneuvers: [], currentStepIndex: 0, eta: 0, distance: 0, steps: 0, safetyScore: 100, safetyLabel: 'Sangat Aman', hazardWarnings: [], maneuverCoords: [] });
    setSearchQuery(''); setSuggestions([]);
  }

  const currentManeuver = routeState.maneuvers[routeState.currentStepIndex];
  const currentInstruction = currentManeuver ? translateManeuver(currentManeuver.instruction, currentManeuver.modifier) : '';
  const maneuverDistance = currentManeuver ? formatDistance(currentManeuver.distance) : '';
  const currentRoad = currentManeuver?.way_name || '';
  const maneuverIcon = currentManeuver ? (MANEUVER_ICONS[currentManeuver.type?.toLowerCase()] || '➡️') : '🏁';

  if (tokenError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-[1]">
        <div className="max-w-sm mx-4 space-y-4 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-3xl flex items-center justify-center mx-auto border border-red-500/30">
            <MapPin className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white mb-2">Mapbox Token Bermasalah</h2>
            <p className="text-sm text-white/50 leading-relaxed">{tokenError}</p>
          </div>
          <button onClick={() => window.open('https://account.mapbox.com/access-tokens/', '_blank')} className="w-full bg-brand-orange text-white py-3 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-brand-orange/90 transition-colors">
            Dapatkan Public Token
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>

      {/* ─── FULL-SCREEN MAP (always behind) ─── */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0"
        style={{ zIndex: 1 }}
      />

      {/* ─── CAMERA OVERLAY (AI scanning during navigation) ─── */}
      <div className={cn(
        "absolute inset-0 transition-opacity duration-1000",
        routeState.isNavigating && isCameraActive ? "opacity-100" : "opacity-0 pointer-events-none"
      )} style={{ zIndex: 2 }}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale brightness-50 contrast-125" />
      </div>

      {/* ─── CAMERA PREVIEW (idle/search state) ─── */}
      <div className={cn(
        "absolute inset-0 transition-opacity duration-500 pointer-events-none",
        activeTab === 'camera' && isCameraActive && !routeState.routeGeometry ? "opacity-100" : "opacity-0 pointer-events-none"
      )} style={{ zIndex: 9 }}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
        {/* Camera scan frame */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-64 h-64 border-2 border-brand-orange/60 rounded-3xl" />
        </div>
        <div className="absolute bottom-20 left-4 right-4 text-center">
          <p className="text-white text-xs font-bold uppercase tracking-widest">AI Road Scanner Active</p>
          <p className="text-white/60 text-[10px] mt-1">Scanning every 5 seconds...</p>
        </div>
      </div>

      {/* Camera toggle button (top-right) when in preview/search state */}
      {activeTab === 'camera' && !routeState.routeGeometry && (
        <div className="absolute top-4 right-4 pointer-events-auto" style={{ zIndex: 11 }}>
          <button
            onClick={startCamera}
            className="w-10 h-10 bg-white/90 backdrop-blur-xl rounded-2xl shadow-lg border border-white/20 flex items-center justify-center hover:bg-white transition-colors"
          >
            <Camera className="w-4 h-4 text-zinc-600" />
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          STATE 1: IDLE — no route, show compact search + tab bar
      ══════════════════════════════════════════ */}
      {!routeState.routeGeometry && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
          {/* Compact search bar — top */}
          <div className="pointer-events-auto absolute top-3 left-3 right-3">
            <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2">
                <Search className="text-zinc-400 w-4 h-4 shrink-0" />
                <input
                  type="text" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Cari lokasi tujuan..."
                  className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-zinc-800 placeholder-zinc-400"
                  onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); setSuggestions([]); } }}
                />
                {searchLoading && <div className="w-3.5 h-3.5 border-2 border-zinc-300 border-t-brand-orange rounded-full animate-spin shrink-0" />}
                {(searchQuery || suggestions.length > 0) && (
                  <button onClick={() => { setSearchQuery(''); setSuggestions([]); }} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Profile selector */}
              <div className="px-3 pt-1.5 flex items-center gap-1">
                {([
                  { id: 'driving-traffic', label: 'Motor', icon: '🏍️' },
                  { id: 'cycling', label: 'Sepeda', icon: '🚲' },
                  { id: 'walking', label: 'Jalan', icon: '🚶' },
                ] as const).map(p => (
                  <button
                    key={p.id}
                    onClick={() => setRouteProfile(p.id)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold transition-all border",
                      routeProfile === p.id
                        ? "bg-brand-orange text-white border-brand-orange"
                        : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-brand-orange/40"
                    )}
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              {/* Location status strip */}
              {locationStatus === 'error' && (
                <div className="px-3 pb-2 border-t border-zinc-100 flex items-center gap-2">
                  <span className="text-[10px] text-red-500 flex-1">{locationErrorMsg}</span>
                  <button onClick={fetchLocation} className="text-[10px] text-brand-orange font-medium hover:underline">Coba Lagi</button>
                </div>
              )}
              {locationStatus === 'loading' && (
                <div className="px-3 pb-2 border-t border-zinc-100 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 border-2 border-zinc-200 border-t-blue-500 rounded-full animate-spin shrink-0" />
                  <span className="text-[10px] text-zinc-400">Mencari lokasi...</span>
                </div>
              )}
              {locationStatus === 'success' && (
                <div className="px-3 pb-2 border-t border-zinc-100 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <span className="text-[10px] text-zinc-400">Lokasi terdeteksi</span>
                </div>
              )}

              {/* Suggestions */}
              <AnimatePresence>
                {(suggestions.length > 0 || searchError) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-zinc-100 overflow-hidden"
                  >
                    {searchError && !searchLoading && (
                      <div className="px-3 py-2"><p className="text-[10px] text-red-500">{searchError}</p></div>
                    )}
                    {suggestions.map(s => (
                      <button
                        key={s.id} onClick={() => calculateRoute(s)}
                        className="w-full px-3 py-2 flex items-start gap-2 hover:bg-zinc-50 transition-colors text-left border-t border-zinc-100 first:border-t-0"
                      >
                        <MapPin className="w-3.5 h-3.5 text-brand-orange mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-zinc-800 leading-tight">{s.text}</p>
                          <p className="text-[10px] text-zinc-400 leading-tight mt-0.5 line-clamp-1">
                            {s.place_name.replace(s.text + ', ', '')}
                          </p>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom Tab Bar */}
          <div className="absolute bottom-4 left-3 right-3 pointer-events-auto">
            <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 px-1.5 py-1 flex items-center gap-0.5">
              {[
                { id: 'map' as const, icon: Navigation, label: 'Peta' },
                { id: 'search' as const, icon: Search, label: 'Cari' },
                { id: 'camera' as const, icon: Camera, label: 'Kamera' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id === 'camera') setIsCameraActive(prev => !prev);
                  }}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-all text-[10px] font-bold",
                    activeTab === tab.id
                      ? "bg-brand-orange text-white shadow"
                      : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  <tab.icon className={cn("w-4 h-4", activeTab === tab.id ? "rotate-45" : "")} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          STATE 2: ROUTE PREVIEW — ultra slim, map takes 80%+ space
      ══════════════════════════════════════════ */}
      {routeState.routeGeometry && !routeState.isNavigating && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
          {/* Back button — top left corner, tiny circle */}
          <div className="absolute top-3 left-3 pointer-events-auto">
            <button
              onClick={resetRoute}
              className="w-7 h-7 bg-white/90 backdrop-blur rounded-full shadow flex items-center justify-center hover:bg-white transition-colors"
            >
              <RotateCcw className="w-3 h-3 text-zinc-600" />
            </button>
          </div>

          {/* Destination pill — top right corner, tiny */}
          <div className="absolute top-3 right-3 pointer-events-auto">
            <div className="bg-white/90 backdrop-blur rounded-full px-2 py-1 shadow flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 text-brand-orange shrink-0" />
              <p className="text-[9px] font-semibold text-zinc-800 truncate max-w-[100px]">{routeState.destination?.text}</p>
            </div>
          </div>

          {/* Bottom strip — ultra slim stats + action pills */}
          <div className="absolute bottom-4 left-3 right-3 pointer-events-auto">
            <div className="bg-white/90 backdrop-blur rounded-2xl shadow overflow-hidden flex items-center">
              {/* Stats — 3 small cells */}
              <div className="flex flex-1 divide-x divide-zinc-100">
                <div className="flex-1 text-center py-1.5">
                  <p className="text-[10px] font-black text-zinc-800 leading-tight">{formatDistance(routeState.distance)}</p>
                  <p className="text-[7px] text-zinc-400 uppercase tracking-widest leading-tight">jarak</p>
                </div>
                <div className="flex-1 text-center py-1.5">
                  <p className="text-[10px] font-black text-zinc-800 leading-tight">{formatDuration(routeState.eta * 60)}</p>
                  <p className="text-[7px] text-zinc-400 uppercase tracking-widest leading-tight">waktu</p>
                </div>
                <div className="flex-1 text-center py-1.5">
                  <p className={routeState.safetyScore >= 80 ? "text-[10px] font-black text-green-500" : routeState.safetyScore >= 60 ? "text-[10px] font-black text-yellow-500" : "text-[10px] font-black text-red-500"}>
                    {routeState.safetyScore}
                  </p>
                  <p className="text-[7px] text-zinc-400 uppercase tracking-widest leading-tight">safety</p>
                </div>
              </div>

              {/* Action pills */}
              <div className="flex items-center gap-1 px-1.5 py-1.5">
                {/* Profile selector */}
                <div className="flex items-center gap-0.5">
                  {([
                    { id: 'driving-traffic', label: 'Motor', icon: '🏍️' },
                    { id: 'cycling', label: 'Sepeda', icon: '🚲' },
                    { id: 'walking', label: 'Jalan', icon: '🚶' },
                  ] as const).map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setRouteProfile(p.id); if (routeState.destination) calculateRoute(routeState.destination); }}
                      className={cn(
                        "flex items-center gap-0.5 px-1 py-0.5 rounded-md text-[7px] font-bold transition-all border",
                        routeProfile === p.id
                          ? "bg-brand-orange text-white border-brand-orange"
                          : "text-zinc-400 border-zinc-200 hover:border-brand-orange/40"
                      )}
                    >
                      <span>{p.icon}</span>
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={resetRoute}
                  className="py-1 px-1.5 rounded-lg text-[8px] font-bold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={startNavigation}
                  className="py-1 px-2 rounded-lg text-[8px] font-bold bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors"
                >
                  Navigasi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          STATE 3: ACTIVE NAVIGATION — single minimal bottom sheet
      ══════════════════════════════════════════ */}
      <AnimatePresence>
        {routeState.isNavigating && routeState.routeGeometry && (
          <>
            {/* ── HAZARD ALERTS — top right, compact pills ── */}
            {hazards.length > 0 && (
              <div className="absolute top-3 right-3 pointer-events-auto" style={{ zIndex: 10 }}>
                {hazards.map(h => (
                  <motion.div
                    key={h.id} initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -60, opacity: 0 }}
                    className="bg-red-500/90 backdrop-blur rounded-full px-2.5 py-0.5 flex items-center gap-1 shadow mb-0.5"
                  >
                    <span className="text-[9px]">⚠️</span>
                    <p className="text-[9px] font-bold text-white">{h.type}</p>
                  </motion.div>
                ))}
              </div>
            )}

            
            {/* ── BOTTOM SHEET — single compact bar ── */}
            <div className="absolute bottom-3 left-3 right-3 pointer-events-auto" style={{ zIndex: 10 }}>
              <div className="bg-black/70 backdrop-blur rounded-2xl px-3 py-2 shadow border border-white/10">
                <div className="flex items-center gap-2">
                  {/* ETA + distance */}
                  <div className="flex flex-col items-center shrink-0">
                    <span className="text-[10px] font-black text-orange-400">{routeState.eta}m</span>
                    <span className="text-[7px] text-white/40">sisa</span>
                  </div>
                  <div className="w-px h-6 bg-white/10 shrink-0" />
                  {/* Next step */}
                  <div className="flex-1 min-w-0">
                    {(() => {
                      const nextManeuver = routeState.maneuvers[routeState.currentStepIndex + 1];
                      const next = nextManeuver ? translateManeuver(nextManeuver.instruction, nextManeuver.modifier) : 'Tiba di tujuan';
                      return <p className="text-[9px] text-white/60 leading-tight truncate">↑ {next}</p>;
                    })()}
                  </div>
                  {/* Progress dots */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {routeState.maneuvers.slice(0, 8).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-1 rounded-full transition-all",
                          i < routeState.currentStepIndex ? "w-2 bg-brand-orange" :
                          i === routeState.currentStepIndex ? "w-3 bg-white" : "w-1 bg-white/20"
                        )}
                      />
                    ))}
                    {routeState.maneuvers.length > 8 && <span className="text-[7px] text-white/30">+{routeState.maneuvers.length - 8}</span>}
                  </div>
                  <div className="w-px h-6 bg-white/10 shrink-0" />
                  {/* Camera toggle */}
                  <button
                    onClick={() => setIsCameraActive(!isCameraActive)}
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all",
                      isCameraActive ? "bg-red-500 text-white" : "bg-white/20 text-white/60"
                    )}
                  >
                    <Camera className="w-3 h-3" />
                  </button>
                  {/* End */}
                  <button
                    onClick={cancelNavigation}
                    className="w-7 h-7 rounded-full bg-white/20 text-white/60 flex items-center justify-center shrink-0 hover:bg-white/30 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}