import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, Navigation, MapPin, Search, X, ArrowRight, ChevronRight, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

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
  maneuverCoords: [number, number][]; // coordinates for each maneuver for proximity detection
}

const MANEUVER_ICONS: Record<string, string> = {
  depart: '🚀',
  turn: '↩️',
  merge: '↗️',
  'on ramp': '🛣️',
  'off ramp': '↘️',
  fork: '↗️',
  'end of road': '↩️',
  continue: '➡️',
  'new name': '➡️',
  destination: '🏁',
  'destination reached': '✅',
  'rotary': '🔄',
  'roundabout': '🔄',
};

const DIRECTION_SUFFIX: Record<string, string> = {
  right: ' ke kanan',
  left: ' ke kiri',
  'slight right': ' sedikit ke kanan',
  'slight left': ' sedikit ke kiri',
  sharp: ' tajam',
  straight: ' terus',
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
  let suffix = '';
  if (modifier) {
    suffix = DIRECTION_SUFFIX[modifier.toLowerCase()] || '';
  }
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
  const routeLayerAddedRef = useRef(false);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [hazards, setHazards] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Ref to prevent debounce re-trigger when setSearchQuery is called inside calculateRoute
  const isCalculatingRouteRef = useRef(false);

  const [routeState, setRouteState] = useState<RouteState>({
    isNavigating: false,
    origin: null,
    destination: null,
    routeGeometry: null,
    maneuvers: [],
    currentStepIndex: 0,
    eta: 0,
    distance: 0,
    steps: 0,
    safetyScore: 100,
    safetyLabel: 'Sangat Aman',
    hazardWarnings: [],
    maneuverCoords: [],
  });

  const [currentLocation, setCurrentLocation] = useState<[number, number]>([107.3371, -6.3065]); // Karawang
  const currentLocationRef = useRef(currentLocation);
  useEffect(() => { currentLocationRef.current = currentLocation; }, [currentLocation]);
  const userLocationMarker = useRef<mapboxgl.Marker | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [currentTime, setCurrentTime] = useState('');

  // Geolocation status: 'loading' | 'success' | 'error' | null
  const [locationStatus, setLocationStatus] = useState<'loading' | 'success' | 'error' | null>(null);
  const [locationErrorMsg, setLocationErrorMsg] = useState('');

  // Token validation
  useEffect(() => {
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('your_mapbox_token')) {
      setTokenError('Mapbox token tidak ditemukan. Set VITE_MAPBOX_ACCESS_TOKEN di .env');
      return;
    }
    if (!MAPBOX_TOKEN.startsWith('pk.')) {
      setTokenError('Token Mapbox harus dimulai dengan "pk."');
      return;
    }
  }, []);

  // Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Camera
  useEffect(() => {
    if (isCameraActive) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [isCameraActive]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access failed", err);
    }
  }

  function stopCamera() {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
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
          body: JSON.stringify({
            image: base64Image,
            location: { lat: currentLocation[1], lng: currentLocation[0] }
          })
        });
        if (response.ok) {
          const result = await response.json();
          if (result.hazardDetected) {
            const newHazard = {
              id: Date.now(),
              type: result.type || "Bahaya Jalan",
              distance: "dekat",
              severityColor: result.severity === 'high' ? "text-red-500" : "text-brand-orange"
            };
            setHazards(prev => [newHazard, ...prev].slice(0, 3));
            const speech = new SpeechSynthesisUtterance(`Waspada di depan: ${result.description || result.type}`);
            window.speechSynthesis.speak(speech);
          }
        }
      }
    } catch (err) {
      console.warn("AI scanning error", err);
    }
  }

  // AI scan interval
  useEffect(() => {
    if (!isCameraActive) return;
    const interval = setInterval(scanRoad, 5000);
    return () => clearInterval(interval);
  }, [isCameraActive, currentLocation]);

  // Geolocation — get user's real location
  const fetchLocation = useCallback(() => {
    if (!navigator.geolocation) {
      console.error('❌ Geolocation not supported');
      setLocationStatus('error');
      setLocationErrorMsg('Geolocation tidak didukung browser ini');
      return;
    }
    console.log('🔍 Requesting location...');
    setLocationStatus('loading');
    setLocationErrorMsg('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log('✅ Location found:', pos.coords);
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;

        // Check if location is reasonable (within Indonesia bounds)
        const isInIndonesia = lng >= 95 && lng <= 141 && lat >= -11 && lat <= 6;

        if (!isInIndonesia) {
          console.warn('⚠️ Location outside Indonesia, using Karawang fallback');
          setCurrentLocation([107.3371, -6.3065]); // Karawang
          setLocationStatus('error');
          setLocationErrorMsg('Lokasi terdeteksi di luar Indonesia. Menggunakan Karawang sebagai default.');
        } else {
          setCurrentLocation([lng, lat]);
          setLocationStatus('success');
          setLocationErrorMsg('');
        }

        if (mapInstanceRef.current) {
          const finalLocation = isInIndonesia ? [lng, lat] : [107.3371, -6.3065];
          mapInstanceRef.current.flyTo({ center: finalLocation as [number, number], zoom: 14 });
        }
      },
      (err) => {
        console.error('❌ Geolocation error:', {
          code: err.code,
          message: err.message
        });
        setLocationStatus('error');
        const msg = err.code === 1
          ? 'Izin lokasi ditolak. Aktifkan lokasi di pengaturan browser.'
          : err.code === 2
          ? 'Lokasi tidak tersedia. Pastikan GPS aktif.'
          : err.code === 3
          ? 'Timeout mencari lokasi. Coba lagi.'
          : 'Gagal mendapatkan lokasi. Coba lagi.';
        setLocationErrorMsg(msg);
        // Fallback to Karawang
        setCurrentLocation([107.3371, -6.3065]);
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 300000 }
    );
  }, []);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  // Init map when token is valid
  useEffect(() => {
    if (tokenError || mapInstanceRef.current || !mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN!;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current!,
      style: 'mapbox://styles/mapbox/navigation-night-v1',
      center: currentLocation,
      zoom: 14,
      attributionControl: false,
    });

    map.on('load', () => {
      // Add a pulsing dot for user location (color changes based on status)
      const el = document.createElement('div');
      el.className = 'user-location-pulse';
      el.style.cssText = `
        width: 20px; height: 20px; background: #94a3b8;
        border-radius: 50%; border: 3px solid white;
        box-shadow: 0 0 0 0 rgba(148,163,184,0.4);
        animation: pulse 2s infinite;
        transition: background 0.3s ease;
      `;
      const style = document.createElement('style');
      style.textContent = `@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); } 70% { box-shadow: 0 0 0 12px rgba(59,130,246,0); } 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); } }`;
      document.head.appendChild(style);

      userLocationMarker.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(currentLocation)
        .addTo(map);

      // Track user location — use functional setRouteState to avoid stale closure
      navigator.geolocation?.watchPosition((pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        setCurrentLocation([lng, lat]);
        userLocationMarker.current?.setLngLat([lng, lat]);

        // Proximity-based turn-by-turn (functional update avoids stale routeState)
        setRouteState(prev => {
          if (!prev.isNavigating || prev.maneuverCoords.length === 0) return prev;
          const nextIdx = prev.currentStepIndex + 1;
          if (nextIdx >= prev.maneuverCoords.length) return prev;
          const nextCoord = prev.maneuverCoords[nextIdx];
          const ARRIVAL_THRESHOLD = 50; // meters
          const dist = haversineM([lng, lat], nextCoord);
          if (dist <= ARRIVAL_THRESHOLD) {
            console.log(`✅ Step ${nextIdx}: ${prev.maneuvers[nextIdx]?.instruction}`);
            const afterNext = prev.maneuvers[nextIdx + 1];
            if (afterNext) {
              const utterance = new SpeechSynthesisUtterance(
                translateManeuver(afterNext.instruction, afterNext.modifier)
              );
              utterance.lang = 'id-ID';
              utterance.rate = 1.1;
              window.speechSynthesis?.speak(utterance);
            }
            return { ...prev, currentStepIndex: nextIdx };
          }
          return prev;
        });
      });
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [tokenError]);

  // Update marker color based on location status
  useEffect(() => {
    const markerEl = userLocationMarker.current?.getElement();
    if (!markerEl) return;

    if (locationStatus === 'loading') {
      markerEl.style.background = '#94a3b8'; // gray
      markerEl.style.animation = 'pulse 1s infinite';
    } else if (locationStatus === 'success') {
      markerEl.style.background = '#3b82f6'; // blue
      markerEl.style.animation = 'pulse 2s infinite';
      userLocationMarker.current?.setLngLat(currentLocation);
    } else if (locationStatus === 'error') {
      markerEl.style.background = '#ef4444'; // red
      markerEl.style.animation = 'none';
    }
  }, [locationStatus, currentLocation]);

  // Show route on map when routeGeometry changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !routeState.routeGeometry) return;

    const sourceId = 'route-source';
    const layerId = 'route-layer';

    // Remove old layer if exists
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: routeState.routeGeometry,
        properties: {},
      },
    });

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#f97316',
        'line-width': 5,
        'line-opacity': 0.8,
      },
    });

    // Fit map to route bounds
    const coords = routeState.routeGeometry.coordinates;
    if (coords.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const c of coords) {
        bounds.extend([c[0], c[1]] as [number, number]);
      }
      map.fitBounds(bounds, { padding: 80, duration: 1000 });
    }

    routeLayerAddedRef.current = true;

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      routeLayerAddedRef.current = false;
    };
  }, [routeState.routeGeometry]);

  // Search for places
  // NOTE: we use currentLocationRef (not currentLocation) to avoid rebuilding the function
  // on every GPS update — which would reset the debounce timer and prevent searches from completing
  const searchPlaces = useCallback(async (query: string) => {
    if (!query.trim()) { setSuggestions([]); return; }
    setSearchLoading(true);
    setSearchError('');
    try {
      const locationAtCall = currentLocationRef.current;
      const proximity = `${locationAtCall[0]},${locationAtCall[1]}`;
      const url = `/api/geocode?query=${encodeURIComponent(query)}&proximity=${proximity}`;
      console.log('Geocoding request:', url);
      const res = await fetch(url);
      const data = await res.json();

      console.log('Geocoding response:', data);

      if (data.error && !data.features) {
        setSearchError(data.error);
        setSuggestions([]);
        return;
      }

      if (data.features && data.features.length > 0) {
        console.log(`✅ Found ${data.features.length} results`);
        setSuggestions(data.features as GeocodingFeature[]);
      } else {
        setSuggestions([]);
        setSearchError('Tidak ada hasil ditemukan. Coba kata kunci lain.');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setSearchError('Gagal mencari lokasi. Cek koneksi internet.');
      setSuggestions([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip re-search if setSearchQuery was just called inside calculateRoute
    if (isCalculatingRouteRef.current) {
      isCalculatingRouteRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (searchQuery.trim()) searchPlaces(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchPlaces]);

  // Calculate route
  async function calculateRoute(dest: GeocodingFeature) {
    // Set flag to prevent debounce from re-searching when we update searchQuery
    isCalculatingRouteRef.current = true;
    setSearchQuery(dest.place_name);
    setSearchError('');

    const origin: [number, number] = currentLocation;
    const destination: [number, number] = dest.center;

    console.log('Calculate route:', { origin, destination });

    // Check if origin and destination are too far apart (> 100km)
    const distance = Math.sqrt(
      Math.pow((destination[0] - origin[0]) * 111, 2) +
      Math.pow((destination[1] - origin[1]) * 111, 2)
    );

    if (distance > 100) {
      setSearchError(`Jarak terlalu jauh (${distance.toFixed(0)}km). Mapbox free tier maksimal 100km. Silakan pilih lokasi yang lebih dekat.`);
      console.warn('Distance too far:', distance, 'km');
      return;
    }

    try {
      const res = await fetch('/api/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      });

      console.log('Directions response status:', res.status);

      if (!res.ok) {
        const errorData = await res.json();
        console.error('Directions error:', errorData);

        if (errorData.error?.includes('maximum distance')) {
          setSearchError('Jarak terlalu jauh untuk rute gratis. Pilih lokasi dalam radius 100km.');
        } else {
          setSearchError(errorData.error || 'Gagal menghitung rute');
        }
        return;
      }

      const data = await res.json();
      console.log('Directions data:', data);

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const steps = data.routes[0].legs?.[0]?.steps || [];

        // Extract maneuver coordinates for proximity-based turn-by-turn
        const maneuverCoords: [number, number][] = steps.map((step: any) => {
          const loc = step.maneuver?.location ?? step.location ?? step.intersections?.[0]?.location ?? null;
          return (loc ? [loc[0], loc[1]] : currentLocation) as [number, number];
        });

        // Get safety data from server
        const safetyScore = data.routes[0].safetyScore ?? 100;
        const safetyLabel = data.safetySummary?.label ?? 'Sangat Aman';
        const hazardWarnings = data.routes[0].hazardWarnings ?? [];

        console.log('Route found:', {
          duration: route.duration,
          distance: route.distance,
          steps: steps.length,
          safetyScore,
          hazardWarnings: hazardWarnings.length
        });

        setRouteState(prev => ({
          ...prev,
          isNavigating: false,
          origin,
          destination: dest,
          routeGeometry: route.geometry,
          maneuvers: steps,
          currentStepIndex: 0,
          eta: Math.round(route.duration / 60),
          distance: Math.round(route.distance),
          steps: steps.length,
          safetyScore,
          safetyLabel,
          hazardWarnings,
          maneuverCoords,
        }));
      } else {
        console.error('No routes found in response');
        setSearchError('Rute tidak ditemukan');
      }
    } catch (error: any) {
      console.error('Calculate route error:', error);
      setSearchError(error.message || 'Gagal menghitung rute');
    }
  }

  // Haversine distance in meters between two [lng, lat] points
  function haversineM(a: [number, number], b: [number, number]): number {
    const R = 6371000;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  // Proximity-based turn-by-turn: advance when user is within ARRIVAL_THRESHOLD meters of maneuver point
  function advanceToNextStep(userPos: [number, number]) {
    setRouteState(prev => {
      if (!prev.isNavigating || prev.maneuvers.length === 0) return prev;

      const nextIdx = prev.currentStepIndex + 1;
      if (nextIdx >= prev.maneuvers.length) return prev;

      const nextCoord = prev.maneuverCoords[nextIdx];
      if (!nextCoord) return prev;

      const dist = haversineM(userPos, nextCoord);
      const ARRIVAL_THRESHOLD = 50; // meters

      if (dist <= ARRIVAL_THRESHOLD) {
        const nextManeuver = prev.maneuvers[nextIdx];
        console.log(`✅ Arrived at step ${nextIdx}: ${nextManeuver.instruction} (was ${dist.toFixed(0)}m away)`);

        // Announce next turn if there is one
        const afterNext = prev.maneuvers[nextIdx + 1];
        if (afterNext) {
          const utterance = new SpeechSynthesisUtterance(
            translateManeuver(afterNext.instruction, afterNext.modifier)
          );
          utterance.lang = 'id-ID';
          utterance.rate = 1.1;
          window.speechSynthesis?.speak(utterance);
        }

        return { ...prev, currentStepIndex: nextIdx };
      }

      return prev;
    });
  }

  // Auto-advance steps every 30s during active navigation
  useEffect(() => {
    if (!routeState.isNavigating) return;
    // Removed timer-based auto-advance — now using proximity-based detection via watchPosition
  }, [routeState.isNavigating]);

  function startNavigation() {
    setRouteState(prev => ({ ...prev, isNavigating: true }));
    setIsCameraActive(true);
  }

  function cancelNavigation() {
    setRouteState(prev => ({
      ...prev,
      isNavigating: false,
      currentStepIndex: 0,
    }));
    setIsCameraActive(false);
    setHazards([]);
    window.speechSynthesis?.cancel();
  }

  function resetRoute() {
    cancelNavigation();
    setRouteState(prev => ({
      ...prev,
      origin: null,
      destination: null,
      routeGeometry: null,
      maneuvers: [],
      eta: 0,
      distance: 0,
      safetyScore: 100,
      safetyLabel: 'Sangat Aman',
      hazardWarnings: [],
      maneuverCoords: [],
    }));
    setSearchQuery('');
    setSuggestions([]);
  }

  const currentManeuver = routeState.maneuvers[routeState.currentStepIndex];
  const nextManeuver = routeState.maneuvers[routeState.currentStepIndex + 1];

  const currentInstruction = currentManeuver
    ? translateManeuver(currentManeuver.instruction, currentManeuver.modifier)
    : '';
  const maneuverDistance = currentManeuver ? formatDistance(currentManeuver.distance) : '';
  const currentRoad = currentManeuver?.way_name || '';
  const nextInstruction = nextManeuver
    ? translateManeuver(nextManeuver.instruction, nextManeuver.modifier)
    : 'Anda telah tiba di tujuan';

  const maneuverIcon = currentManeuver
    ? MANEUVER_ICONS[currentManeuver.type?.toLowerCase()] || '➡️'
    : '🏁';

  if (tokenError) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 p-8 text-center">
        <div className="max-w-sm space-y-4">
          <div className="w-16 h-16 bg-red-500/20 rounded-3xl flex items-center justify-center mx-auto border border-red-500/30">
            <MapPin className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white mb-2">Mapbox Token Bermasalah</h2>
            <p className="text-sm text-white/50 leading-relaxed">{tokenError}</p>
          </div>
          <button
            onClick={() => window.open('https://account.mapbox.com/access-tokens/', '_blank')}
            className="w-full bg-brand-orange text-white py-3 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-brand-orange/90 transition-colors"
          >
            Dapatkan Public Token
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 relative">
      {/* Background Camera (AI Scanning) */}
      <div className={cn(
        "absolute inset-0 z-0 transition-opacity duration-1000",
        isCameraActive && routeState.isNavigating ? "opacity-100" : "opacity-0 pointer-events-none"
      )}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover grayscale brightness-50 contrast-125"
        />
      </div>

      {/* Map (always visible when not in camera-only mode) */}
      <div className={cn(
        "absolute inset-0 z-0 transition-opacity duration-700",
        routeState.isNavigating && isCameraActive ? "opacity-20" : "opacity-100"
      )}>
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      {/* Main UI Overlay */}
      <div className="relative z-10 flex flex-col h-full">
        {/* Search Bar — shown when no active route */}
        {!routeState.isNavigating && (
          <div className="p-4 pt-4">
            <div className="bg-zinc-900/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
              {/* Search Input */}
              <div className="flex items-center gap-3 p-4">
                <Search className="text-white/40 w-5 h-5 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Cari lokasi tujuan..."
                  className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-white placeholder-white/20"
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setSearchQuery(''); setSuggestions([]); }
                  }}
                />
                {searchLoading && (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-brand-orange rounded-full animate-spin shrink-0" />
                )}
                {(searchQuery || suggestions.length > 0) && (
                  <button
                    onClick={() => { setSearchQuery(''); setSuggestions([]); }}
                    className="text-white/40 hover:text-white/70 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Location Status Indicator */}
              {locationStatus && locationStatus !== 'success' && (
                <div className="px-4 pb-3 border-t border-white/5">
                  <div className="flex items-center gap-2 mt-3">
                    {locationStatus === 'loading' && (
                      <>
                        <div className="w-3 h-3 border-2 border-white/20 border-t-blue-500 rounded-full animate-spin shrink-0" />
                        <span className="text-xs text-white/50">Mencari lokasi Anda...</span>
                      </>
                    )}
                    {locationStatus === 'error' && (
                      <>
                        <span className="text-xs text-red-400 flex-1">{locationErrorMsg}</span>
                        <button
                          onClick={fetchLocation}
                          className="text-xs text-brand-orange hover:text-brand-orange/80 font-medium transition-colors shrink-0"
                        >
                          Coba Lagi
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Suggestions Dropdown */}
              <AnimatePresence>
                {(suggestions.length > 0 || searchLoading || searchError) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/5 overflow-hidden"
                  >
                    {/* Loading state */}
                    {searchLoading && (
                      <div className="px-4 py-3 flex items-center gap-3 border-t border-white/5">
                        <div className="w-4 h-4 border-2 border-white/10 border-t-brand-orange rounded-full animate-spin shrink-0" />
                        <span className="text-xs text-white/40">Mencari lokasi...</span>
                      </div>
                    )}
                    {/* Error state */}
                    {searchError && !searchLoading && (
                      <div className="px-4 py-3 border-t border-white/5">
                        <p className="text-xs text-red-400">{searchError}</p>
                      </div>
                    )}
                    {/* Results */}
                    {!searchLoading && suggestions.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => calculateRoute(s)}
                        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors text-left border-t border-white/5 first:border-t-0"
                      >
                        <MapPin className="w-4 h-4 text-brand-orange mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-white leading-tight">{s.text}</p>
                          <p className="text-xs text-white/40 leading-tight mt-0.5 line-clamp-1">
                            {s.place_name.replace(s.text + ', ', '')}
                          </p>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Route Preview — shown when route is calculated */}
              {routeState.routeGeometry && !routeState.isNavigating && (
                <div className="border-t border-white/5">
                  <div className="p-4 space-y-3">
                    {/* Origin */}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                      <div>
                        <p className="text-[10px] text-white/30 uppercase font-black tracking-widest">Asal</p>
                        <p className="text-xs text-white/70">Lokasi saya</p>
                      </div>
                    </div>

                    {/* Route line */}
                    <div className="flex items-center gap-2 pl-4">
                      <div className="w-px h-4 border-l-2 border-dashed border-white/10 ml-[-1px]" />
                      <ArrowRight className="w-3 h-3 text-brand-orange/60" />
                    </div>

                    {/* Destination */}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-orange/20 flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4 text-brand-orange" />
                      </div>
                      <div>
                        <p className="text-[10px] text-white/30 uppercase font-black tracking-widest">Tujuan</p>
                        <p className="text-xs font-medium text-white leading-tight line-clamp-1">
                          {routeState.destination?.text}
                        </p>
                      </div>
                    </div>

                    {/* Route Stats */}
                    <div className="grid grid-cols-4 gap-2 mt-2 pt-3 border-t border-white/5">
                      <div className="text-center">
                        <p className="text-lg font-black text-white">{formatDistance(routeState.distance)}</p>
                        <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Jarak</p>
                      </div>
                      <div className="text-center border-x border-white/5">
                        <p className="text-lg font-black text-white">{formatDuration(routeState.eta * 60)}</p>
                        <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Waktu</p>
                      </div>
                      <div className="text-center border-x border-white/5">
                        {/* Safety Score Badge */}
                        <p className={routeState.safetyScore >= 80 ? "text-lg font-black text-green-400" : routeState.safetyScore >= 60 ? "text-lg font-black text-yellow-400" : "text-lg font-black text-red-400"}>
                          {routeState.safetyScore}
                        </p>
                        <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Safety</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-black text-white">{routeState.steps}</p>
                        <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Langkah</p>
                      </div>
                    </div>

                    {/* Safety Badge */}
                    <div className={routeState.safetyScore >= 80 ? "bg-green-500/15 border border-green-500/30 rounded-xl px-3 py-2 flex items-center gap-2" : routeState.safetyScore >= 60 ? "bg-yellow-500/15 border border-yellow-500/30 rounded-xl px-3 py-2 flex items-center gap-2" : "bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2 flex items-center gap-2"}>
                      <span className="text-sm">{routeState.safetyScore >= 80 ? "🟢" : routeState.safetyScore >= 60 ? "🟡" : "🔴"}</span>
                      <span className={routeState.safetyScore >= 80 ? "text-xs font-bold text-green-400" : routeState.safetyScore >= 60 ? "text-xs font-bold text-yellow-400" : "text-xs font-bold text-red-400"}>
                        {routeState.safetyLabel}
                      </span>
                      {routeState.hazardWarnings.length > 0 && (
                        <span className="text-xs text-white/50 ml-auto">
                          {routeState.hazardWarnings.length} peringatan
                        </span>
                      )}
                    </div>

                    {/* Hazard Warnings List */}
                    {routeState.hazardWarnings.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] text-white/30 uppercase font-black tracking-widest">Peringatan di sepanjang rute:</p>
                        {routeState.hazardWarnings.slice(0, 2).map((w, i) => (
                          <div key={i} className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
                            <span className="text-xs">⚠️</span>
                            <span className="text-xs text-white/70 flex-1">{w.name}</span>
                            <span className={w.severity === 'high' ? "text-xs font-bold text-red-400" : w.severity === 'medium' ? "text-xs font-bold text-yellow-400" : "text-xs font-bold text-orange-400"}>
                              {w.severity === 'high' ? 'Tinggi' : w.severity === 'medium' ? 'Sedang' : 'Rendah'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 mt-3">
                      <button
                        onClick={resetRoute}
                        className="flex-1 py-3 rounded-2xl font-bold text-sm text-white/60 bg-white/5 border border-white/10 flex items-center justify-center gap-2 hover:bg-white/10 transition-colors"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Batal
                      </button>
                      <button
                        onClick={startNavigation}
                        className="flex-[2] py-3 rounded-2xl font-bold text-sm bg-brand-orange text-white shadow-lg shadow-brand-orange/30 flex items-center justify-center gap-2 hover:bg-brand-orange/90 transition-colors active:scale-95"
                      >
                        <Navigation className="w-4 h-4 rotate-45" />
                        Mulai Navigasi
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active Navigation Mode */}
        <AnimatePresence>
          {routeState.isNavigating && routeState.routeGeometry && (
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="flex flex-col h-full"
            >
              {/* Top Instruction Card */}
              <div className="p-4">
                <div className="bg-white/95 backdrop-blur-2xl rounded-3xl p-5 shadow-2xl flex items-center gap-4 border border-white/20">
                  <div className="w-14 h-14 rounded-2xl bg-brand-orange flex items-center justify-center shadow-xl shadow-brand-orange/40 shrink-0 text-2xl">
                    {maneuverIcon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-black/30 uppercase tracking-widest mb-0.5">
                      {maneuverDistance} • {currentRoad || 'Jl. ...'}
                    </p>
                    <h2 className="text-xl font-bold font-display text-black leading-tight">
                      {currentInstruction || 'Mulai perjalanan'}
                    </h2>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-brand-orange font-black text-2xl">{currentTime}</span>
                    <span className="block text-black/30 text-[10px] font-bold uppercase">
                      ETA {routeState.eta} menit
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress indicators */}
              <div className="px-4 mb-2">
                <div className="flex gap-1">
                  {routeState.maneuvers.slice(0, 8).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors",
                        i <= routeState.currentStepIndex ? "bg-brand-orange" : "bg-white/10"
                      )}
                    />
                  ))}
                  {routeState.maneuvers.length > 8 && (
                    <span className="text-[10px] text-white/30 self-center ml-1">+{routeState.maneuvers.length - 8}</span>
                  )}
                </div>
              </div>

              {/* Hazard Alerts */}
              <div className="flex-1 px-4 flex flex-col gap-2 overflow-hidden">
                <AnimatePresence>
                  {hazards.map(h => (
                    <motion.div
                      key={h.id}
                      initial={{ x: 100, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: -100, opacity: 0 }}
                      className="bg-red-500/90 backdrop-blur-sm rounded-2xl p-3 flex items-center gap-3 border-l-4 border-red-300"
                    >
                      <span className="text-lg">⚠️</span>
                      <p className="text-sm font-bold text-white">{h.type}</p>
                      <span className="text-xs text-white/70 ml-auto">{h.distance}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Next Step Preview */}
              <div className="px-4">
                <div className="bg-zinc-900/80 backdrop-blur-xl rounded-2xl p-4 flex items-center gap-3 border border-white/10 mb-4">
                  <ChevronRight className="w-4 h-4 text-white/20" />
                  <p className="text-xs text-white/50">Selanjutnya: <span className="text-white/70 font-medium">{nextInstruction}</span></p>
                </div>
              </div>

              {/* Bottom Controls */}
              <div className="p-4 bg-zinc-950/90 backdrop-blur-sm border-t border-white/5">
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsCameraActive(!isCameraActive)}
                    className={cn(
                      "flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all border",
                      isCameraActive
                        ? "bg-red-500 text-white border-red-400 shadow-lg shadow-red-500/20"
                        : "bg-white/5 text-white/60 border-white/10"
                    )}
                  >
                    <Camera className="w-4 h-4" />
                    {isCameraActive ? "Stop AI Scan" : "Aktifkan AI Scan"}
                  </button>
                  <button
                    onClick={cancelNavigation}
                    className="bg-red-500/20 text-red-400 border border-red-500/30 py-4 px-6 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-500/30 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Batal
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Idle State — no route calculated */}
        {!routeState.routeGeometry && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 rounded-3xl bg-zinc-800/50 flex items-center justify-center mb-4 border border-white/10">
              <Navigation className="w-10 h-10 text-white/20 rotate-45" />
            </div>
            <h3 className="text-lg font-bold text-white/60 mb-1">Rute Belum Ditentukan</h3>
            <p className="text-sm text-white/30 max-w-xs">
              Cari lokasi tujuan di atas untuk menghitung rute dan memulai navigasi turn-by-turn.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}