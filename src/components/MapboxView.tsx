import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { NavigationState } from '../types';
import { Navigation as NavIcon, Send, MapPin, Search, X, ArrowRight, ChevronRight, RotateCcw, Locate } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

// Default to Karawang, West Java
const DEFAULT_CENTER: [number, number] = [107.3371, -6.3065];

interface GeocodingFeature {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
  context?: Array<{ id: string; text: string }>;
  // Enriched fields from server
  full_address?: string;
  short_address?: string;
  district?: string;
  city?: string;
  region?: string;
  postcode?: string;
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

// Rate limit guard: returns true if we should skip this API call
function isRateLimited(key: string, windowMs = 15000): boolean {
  const now = Date.now();
  const last = parseInt(sessionStorage.getItem(key) || '0', 10);
  if (now - last < windowMs) return true;
  sessionStorage.setItem(key, String(now));
  return false;
}

function translateManeuver(instruction?: string, modifier?: string, wayName?: string, distance?: number): string {
  if (!instruction) return 'Lanjutkan perjalanan';
  const lower = instruction.toLowerCase();
  let suffix = '';
  if (modifier) {
    suffix = DIRECTION_SUFFIX[modifier.toLowerCase()] || '';
  }

  // Add road name context when available
  const roadContext = wayName ? ` di ${wayName}` : '';

  if (lower.includes('depart')) return 'Mulai perjalanan' + roadContext;
  if (lower.includes('arrive') || lower.includes('destination')) return 'Anda telah tiba di tujuan';
  if (lower.includes('continue')) {
    // Vary instruction based on distance traveled while continuing
    if (distance !== undefined && distance > 500) {
      return `Terus${suffix} ${formatDistance(distance)}` + roadContext;
    }
    if (wayName) return `Lanjutkan${suffix}${roadContext}`;
    return 'Lanjutkan perjalanan' + suffix;
  }
  if (lower.includes('turn')) return `Belok${suffix}${roadContext}`;
  if (lower.includes('slight right')) return 'Belok sedikit kanan' + roadContext;
  if (lower.includes('slight left')) return 'Belok sedikit kiri' + roadContext;
  if (lower.includes('sharp right')) return 'Belok tajam kanan' + roadContext;
  if (lower.includes('sharp left')) return 'Belok tajam kiri' + roadContext;
  if (lower.includes('right')) return 'Belok kanan' + roadContext;
  if (lower.includes('left')) return 'Belok kiri' + roadContext;
  if (lower.includes('straight')) return 'Lurus terus' + roadContext;
  if (lower.includes('merge')) return 'Bergabung' + suffix + roadContext;
  if (lower.includes('ramp')) return 'Masuk jalan tol' + suffix;
  if (lower.includes('roundabout') || lower.includes('rotary')) return 'Masuk bundaran' + roadContext;
  if (lower.includes('fork')) return 'Ambil jalur' + suffix + roadContext;
  if (lower.includes('exit')) return 'Keluar' + suffix + roadContext;
  if (lower.includes('uturn') || lower.includes('u-turn')) return 'Putar balik' + roadContext;

  return instruction;
}

// Get cardinal direction name from heading
function getDirectionName(heading: number): string {
  const normalized = ((heading % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'Utara';
  if (normalized >= 22.5 && normalized < 67.5) return 'Timur Laut';
  if (normalized >= 67.5 && normalized < 112.5) return 'Timur';
  if (normalized >= 112.5 && normalized < 157.5) return 'Tenggara';
  if (normalized >= 157.5 && normalized < 202.5) return 'Selatan';
  if (normalized >= 202.5 && normalized < 247.5) return 'Barat Daya';
  if (normalized >= 247.5 && normalized < 292.5) return 'Barat';
  if (normalized >= 292.5 && normalized < 337.5) return 'Barat Laut';
  return 'Utara';
}

export default function MapboxView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const userLocationMarker = useRef<mapboxgl.Marker | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const routeLayerAddedRef = useRef(false);

  const [lng, setLng] = useState(DEFAULT_CENTER[0]);
  const [lat, setLat] = useState(DEFAULT_CENTER[1]);
  const [zoom, setZoom] = useState(13);
  const [hasToken, setHasToken] = useState(false);
  const [tokenError, setTokenError] = useState<string>('');
  const [mapError, setMapError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<[number, number]>(DEFAULT_CENTER);
  const currentLocationRef = useRef(currentLocation);
  useEffect(() => { currentLocationRef.current = currentLocation; }, [currentLocation]);
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [currentTime, setCurrentTime] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [userHeading, setUserHeading] = useState(0);
  const [showArrival, setShowArrival] = useState(false);
  const [arrivalDestination, setArrivalDestination] = useState('');

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

  // Validate token on mount
  useEffect(() => {
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('your_mapbox_token')) {
      setTokenError('Token tidak ditemukan. Silakan set VITE_MAPBOX_ACCESS_TOKEN di file .env');
      setIsLoading(false);
      return;
    }

    if (MAPBOX_TOKEN.startsWith('sk.')) {
      setTokenError('Token yang Anda gunakan adalah Secret Key (sk.). Mapbox memerlukan Public Token (pk.) untuk browser.');
      setIsLoading(false);
      return;
    }

    if (!MAPBOX_TOKEN.startsWith('pk.')) {
      setTokenError('Token tidak valid. Token Mapbox harus dimulai dengan "pk."');
      setIsLoading(false);
      return;
    }

    setHasToken(true);
  }, []);

  // Geolocation - continuously track user location
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported');
      setLocationPermission('denied');
      return;
    }

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        console.log('📍 User location detected:', { lat, lng });
        setCurrentLocation([lng, lat]);
        setLng(lng);
        setLat(lat);
        setLocationPermission('granted');
      },
      (error) => {
        console.error('Geolocation error:', error);
        setLocationPermission('denied');
        // Keep default location (Karawang)
      }
    );

    // Watch for position updates
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        setCurrentLocation([lng, lat]);
        setLng(lng);
        setLat(lat);
        setLocationPermission('granted');
      },
      (error) => {
        console.error('Watch position error:', error);
      },
      { enableHighAccuracy: true }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Initialize map when token is valid
  useEffect(() => {
    if (!hasToken || mapInstance.current || !mapContainer.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    try {
      const map = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/navigation-night-v1',
        center: currentLocation,
        zoom: 14,
        pitch: 0, // Will be set to 60 during navigation
        bearing: 0, // Will follow user heading during navigation
        attributionControl: false
      });

      map.on('load', () => {
        console.log('✅ Map loaded successfully');
        setMapError('');
        setIsLoading(false);
        setIsMapLoaded(true);

        // Add user location marker
        const el = document.createElement('div');
        el.className = 'user-location-pulse';
        el.style.cssText = `
          width: 20px; height: 20px; background: #3b82f6;
          border-radius: 50%; border: 3px solid white;
          box-shadow: 0 0 0 0 rgba(59,130,246,0.4);
          animation: pulse 2s infinite;
        `;
        const style = document.createElement('style');
        style.textContent = `@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); } 70% { box-shadow: 0 0 0 12px rgba(59,130,246,0); } 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); } }`;
        document.head.appendChild(style);

        userLocationMarker.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(currentLocation)
          .addTo(map);

        // Track user location, heading and advance navigation steps based on proximity
        navigator.geolocation?.watchPosition((pos) => {
          const lng = pos.coords.longitude;
          const lat = pos.coords.latitude;
          const heading = pos.coords.heading;
          setCurrentLocation([lng, lat]);
          if (heading !== null && !isNaN(heading)) {
            setUserHeading(heading);
          }
          userLocationMarker.current?.setLngLat([lng, lat]);

          // Proximity-based turn-by-turn (using functional setState to avoid stale closure)
          setRouteState(prev => {
            if (!prev.isNavigating || prev.maneuverCoords.length === 0) return prev;
            const nextIdx = prev.currentStepIndex + 1;

            // Check if arrived at destination
            if (nextIdx >= prev.maneuverCoords.length) {
              console.log('🎉 Anda telah tiba di tujuan!');
              // Voice announcement for arrival
              const utterance = new SpeechSynthesisUtterance('Anda telah tiba di tujuan. Terima kasih telah menggunakan Avenly.');
              utterance.lang = 'id-ID';
              utterance.rate = 1.0;
              window.speechSynthesis?.speak(utterance);
              // Show arrival animation
              setShowArrival(true);
              setArrivalDestination(prev.destination?.full_address || prev.destination?.place_name || 'Tujuan');
              return { ...prev, isNavigating: false, currentStepIndex: prev.currentStepIndex };
            }

            const nextCoord = prev.maneuverCoords[nextIdx];
            const ARRIVAL_THRESHOLD = 50;
            const dist = haversineM([lng, lat], nextCoord);
            if (dist <= ARRIVAL_THRESHOLD) {
              console.log(`✅ Step ${nextIdx}: ${prev.maneuvers[nextIdx]?.instruction}`);
              // Voice announcement for next turn
              const afterNext = prev.maneuvers[nextIdx + 1];
              if (afterNext) {
                const utterance = new SpeechSynthesisUtterance(
                  translateManeuver(afterNext.instruction, afterNext.modifier, afterNext.way_name)
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

      map.on('error', (e) => {
        console.error('❌ Map error:', e);
        setMapError(e.error?.message || 'Map failed to load');
        setIsLoading(false);
      });

      map.on('move', () => {
        setLng(Number(map.getCenter().lng.toFixed(4)));
        setLat(Number(map.getCenter().lat.toFixed(4)));
        setZoom(Number(map.getZoom().toFixed(2)));
      });

      mapInstance.current = map;
    } catch (e: any) {
      console.error('❌ Mapbox init failed:', e);
      setMapError(e.message);
      setIsLoading(false);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [hasToken]);

  // Show route on map — only after map is fully loaded
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !isMapLoaded) {
      console.log('⏳ Route effect skipped: map=', !!map, 'isMapLoaded=', isMapLoaded);
      return;
    }

    // Cleanup function: remove all route-related layers, sources, and markers
    function cleanup() {
      try {
        ['route-layer', 'route-glow'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource('route-source')) map.removeSource('route-source');
        routeLayerAddedRef.current = false;
      } catch (error) {
        console.error('Error cleaning up route:', error);
      }
    }

    console.log('🔵 Route effect running:', {
      hasGeometry: !!routeState.routeGeometry,
      hasOrigin: !!routeState.origin,
      hasDest: !!routeState.destination,
      mapReady: map.loaded()
    });

    // If no route — clean up everything including markers, then return
    if (!routeState.routeGeometry) {
      if (originMarkerRef.current) { originMarkerRef.current.remove(); originMarkerRef.current = null; }
      if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null; }
      cleanup();
      return;
    }

    // Add origin marker (user's location)
    if (routeState.origin) {
      if (originMarkerRef.current) originMarkerRef.current.remove();
      const originEl = document.createElement('div');
      originEl.style.cssText = `
        width: 32px; height: 32px; background: #3b82f6; border-radius: 50%;
        border: 3px solid white; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(59,130,246,0.6); cursor: pointer;
      `;
      originEl.innerHTML = `<div style="width:8px;height:8px;background:white;border-radius:50%;"></div>`;
      originMarkerRef.current = new mapboxgl.Marker({ element: originEl, anchor: 'center' })
        .setLngLat(routeState.origin)
        .addTo(map);
      console.log('📍 Origin marker added at:', routeState.origin);
    }

    // Add destination pin marker
    if (routeState.destination) {
      if (destMarkerRef.current) destMarkerRef.current.remove();
      const destEl = document.createElement('div');
      destEl.style.cssText = `width: 40px; height: 52px; background: none; cursor: pointer;`;
      destEl.innerHTML = `
        <svg width="40" height="52" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 0C8.954 0 0 8.954 0 20c0 14.5 20 32 20 32s20-17.5 20-32C40 8.954 31.046 0 20 0z" fill="#f97316"/>
          <circle cx="20" cy="18" r="8" fill="white"/>
          <circle cx="20" cy="18" r="4" fill="#f97316"/>
        </svg>
      `;
      destMarkerRef.current = new mapboxgl.Marker({ element: destEl, anchor: 'bottom' })
        .setLngLat(routeState.destination.center)
        .addTo(map);
      console.log('📍 Destination pin added at:', routeState.destination.center);
    }

    console.log('🟠 Rendering route on map...');

    try {
      cleanup(); // Remove any previous route layers before adding new one

      // Check if map is fully ready
      if (!map.loaded()) {
        console.log('⏳ Map not fully loaded, waiting...');
        map.once('load', () => {
          console.log('✅ Map ready after wait, adding route layer');
          addRouteLayer(map);
        });
      } else {
        addRouteLayer(map);
      }
    } catch (error) {
      console.error('❌ Error in route rendering:', error);
    }

    function addRouteLayer(map: mapboxgl.Map) {
      try {
        map.addSource('route-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: routeState.routeGeometry!,
            properties: {},
          },
        });

        // Outer glow line
        map.addLayer({
          id: 'route-glow',
          type: 'line',
          source: 'route-source',
          paint: { 'line-color': '#f97316', 'line-width': 14, 'line-opacity': 0.25, 'line-blur': 4 },
        });

        // Main route line - high contrast
        map.addLayer({
          id: 'route-layer',
          type: 'line',
          source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 1 },
        });

        // Center line - orange
        map.addLayer({
          id: 'route-center',
          type: 'line',
          source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 1 },
        });

        // Fit map to route with 3D view
        const coords = routeState.routeGeometry!.coordinates;
        if (coords.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();
          for (const c of coords) bounds.extend([c[0], c[1]] as [number, number]);
          map.fitBounds(bounds, { padding: 100, pitch: 45, duration: 1200 });
          console.log('✅ Map fit to route bounds with 3D view');
        }

        routeLayerAddedRef.current = true;
        console.log('✅ Route layer added successfully');
      } catch (error) {
        console.error('❌ addRouteLayer error:', error);
      }
    }
  }, [routeState.routeGeometry, routeState.origin, routeState.destination, isMapLoaded]);

  // Handle 3D camera updates during navigation
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !routeState.isNavigating) return;

    // Enable 3D navigation view when starting navigation
    map.easeTo({ pitch: 60, bearing: 0, zoom: 16, duration: 1000 });
  }, [routeState.isNavigating]);

  // Search for places
  // NOTE: we use currentLocationRef (not currentLocation) to avoid rebuilding the function
  // on every GPS update — which would reset the debounce timer and prevent searches from completing
  const searchPlaces = useCallback(async (query: string) => {
    if (!query.trim()) { setSuggestions([]); return; }
    setSearchLoading(true);
    setSearchError('');

    // Check if query contains "horizon" (case insensitive)
    const isHorizonQuery = query.toLowerCase().includes('horizon');

    try {
      const locationAtCall = currentLocationRef.current;
      const proximity = `${locationAtCall[0]},${locationAtCall[1]}`;
      const url = `/api/geocode?query=${encodeURIComponent(query)}&proximity=${proximity}`;
      console.log('🔍 Searching:', url);
      const res = await fetch(url);
      const data = await res.json();

      console.log('📦 Geocode response:', data);

      if (data.error && !data.features) {
        setSearchError(data.error);
        setSuggestions([]);
        return;
      }

      let results: GeocodingFeature[] = [];

      // Add Horizon University as first result if query contains "horizon"
      if (isHorizonQuery) {
        const horizonUniversity: GeocodingFeature = {
          id: 'horizon-university-karawang',
          place_name: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass No.KM.1, Tanjungpura, Karawang Bar., Karawang, Jawa Barat 41316',
          center: [107.29258097454206, -6.289202887118927],
          text: 'Horizon University Indonesia',
          context: []
        };
        results.push(horizonUniversity);
      }

      // Add Mapbox results
      if (data.features && data.features.length > 0) {
        console.log(`✅ Found ${data.features.length} results`);
        results = [...results, ...(data.features as GeocodingFeature[])];
      }

      if (results.length > 0) {
        setSuggestions(results);
      } else {
        setSuggestions([]);
        setSearchError('Tidak ada hasil ditemukan. Coba kata kunci lain.');
      }
    } catch (err) {
      console.error('❌ Search error:', err);
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
    // Use full address for better readability
    setSearchQuery(dest.full_address || dest.place_name);
    setSearchError('');
    setSuggestions([]); // Clear suggestions list when route is selected

    // Check if we have user location
    if (locationPermission !== 'granted') {
      setSearchError('Izinkan akses lokasi untuk menghitung rute dari posisi Anda');
      return;
    }

    const origin: [number, number] = currentLocation;
    const destination: [number, number] = dest.center;

    console.log('📍 Calculating route from YOUR LOCATION:', {
      origin: `${origin[1].toFixed(4)}, ${origin[0].toFixed(4)}`,
      destination: dest.place_name
    });

    if (isRateLimited('mv_route_call', 20000)) {
      console.warn('⏳ Rate-limited: skipping route API call (too soon since last call)');
      setSearchError('Terlalu cepat. Tunggu beberapa detik sebelum mencari rute lain.');
      return;
    }

    try {
      const res = await fetch('/api/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error('Directions error:', errorData);

        // Handle Mapbox distance limit error
        if (errorData.error?.includes('too long') || errorData.error?.includes('maximum distance')) {
          setSearchError('Jarak terlalu jauh (batas maksimal Mapbox 100km). Pilih lokasi yang lebih dekat.');
        } else {
          setSearchError(errorData.error || 'Gagal menghitung rute');
        }
        return;
      }

      const data = await res.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const steps = route.legs?.[0]?.steps || [];

        // Extract maneuver coordinates for proximity-based turn-by-turn
        const maneuverCoords: [number, number][] = steps.map((step: any) => {
          const loc = step.maneuver?.location ?? step.location ?? step.intersections?.[0]?.location ?? null;
          return (loc ? [loc[0], loc[1]] : currentLocation) as [number, number];
        });

        // Map steps to have way_name (Mapbox uses 'name' for road name)
        const mappedManeuvers: Maneuver[] = steps.map((step: any) => ({
          instruction: step.maneuver?.instruction ?? step.maneuver ?? 'Lanjutkan',
          distance: step.distance ?? 0,
          duration: step.duration ?? 0,
          type: step.maneuver?.type ?? 'unknown',
          modifier: step.maneuver?.modifier,
          way_name: step.name ?? '',
        }));

        // Get safety data from server
        const safetyScore = route.safetyScore ?? 100;
        const safetyLabel = data.safetySummary?.label ?? 'Sangat Aman';
        const hazardWarnings = route.hazardWarnings ?? [];

        console.log('✅ Route found from YOUR LOCATION:', {
          distance: route.distance,
          distance_km: route.distance_km,
          duration: route.duration,
          eta_text: route.eta_text,
          steps: steps.length,
          safetyScore,
          hazardWarnings: hazardWarnings.length
        });

        setRouteState({
          isNavigating: false,
          origin,
          destination: dest,
          routeGeometry: route.geometry,
          maneuvers: mappedManeuvers,
          currentStepIndex: 0,
          eta: Math.round(route.duration / 60),
          distance: Math.round(route.distance),
          steps: steps.length,
          safetyScore,
          safetyLabel,
          hazardWarnings,
          maneuverCoords,
        });
      } else {
        console.error('No routes found in response');
        setSearchError('Rute tidak ditemukan');
      }
    } catch (error: any) {
      console.error('Calculate route error:', error);
      setSearchError(error.message || 'Gagal menghitung rute');
    }
  }

  function startNavigation() {
    const map = mapInstance.current;
    if (map) {
      map.easeTo({ pitch: 60, bearing: 0, duration: 1000 });
      console.log('🗺️ 3D navigation view enabled');
    }
    setRouteState(prev => ({ ...prev, isNavigating: true }));
  }

  function cancelNavigation() {
    const map = mapInstance.current;
    if (map) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
    setRouteState(prev => ({
      ...prev,
      isNavigating: false,
      currentStepIndex: 0,
    }));
  }

  function resetRoute() {
    cancelNavigation();
    const map = mapInstance.current;
    if (map) {
      try {
        ['route-layer', 'route-glow'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource('route-source')) map.removeSource('route-source');
      } catch {}
    }
    originMarkerRef.current?.remove(); originMarkerRef.current = null;
    destMarkerRef.current?.remove(); destMarkerRef.current = null;
    routeLayerAddedRef.current = false;
    setRouteState(prev => ({
      ...prev,
      origin: null,
      destination: null,
      routeGeometry: null,
      maneuvers: [],
      eta: 0,
      distance: 0,
      steps: 0,
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
  const currentInstruction = currentManeuver ? translateManeuver(currentManeuver.instruction, currentManeuver.modifier, currentManeuver.way_name, currentManeuver.distance) : '';
  const maneuverDistance = currentManeuver ? formatDistance(currentManeuver.distance) : '';
  const currentRoad = currentManeuver?.way_name || '';
  const nextInstruction = nextManeuver ? translateManeuver(nextManeuver.instruction, nextManeuver.modifier, nextManeuver.way_name, nextManeuver.distance) : 'Anda telah tiba di tujuan';
  const maneuverIcon = currentManeuver ? MANEUVER_ICONS[currentManeuver.type?.toLowerCase()] || '➡️' : '🏁';

  // My Location button handler
  function locateMyPosition() {
    if (!navigator.geolocation) {
      console.error('❌ Geolocation not supported');
      setSearchError('Geolocation tidak didukung browser ini');
      return;
    }

    console.log('🔍 Requesting location...');
    setIsLocating(true);
    setSearchError(''); // Clear previous errors

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
          setLng(107.3371);
          setLat(-6.3065);
          setSearchError('Lokasi terdeteksi di luar Indonesia. Menggunakan Karawang sebagai default.');
        } else {
          setCurrentLocation([lng, lat]);
          setLng(lng);
          setLat(lat);
        }

        setLocationPermission('granted');

        if (mapInstance.current) {
          const finalLocation = isInIndonesia ? [lng, lat] : [107.3371, -6.3065];
          console.log('🗺️ Flying to location:', finalLocation);
          mapInstance.current.flyTo({ center: finalLocation as [number, number], zoom: 15, duration: 1200 });
        }

        const markerLocation = isInIndonesia ? [lng, lat] : [107.3371, -6.3065];
        userLocationMarker.current?.setLngLat(markerLocation as [number, number]);
        setIsLocating(false);
      },
      (err) => {
        console.error('❌ Geolocation error:', {
          code: err.code,
          message: err.message,
          PERMISSION_DENIED: err.code === 1,
          POSITION_UNAVAILABLE: err.code === 2,
          TIMEOUT: err.code === 3
        });
        setIsLocating(false);

        if (err.code === 1) {
          setSearchError('Izin lokasi ditolak. Klik ikon 🔒 di address bar → Site settings → Location → Allow');
        } else if (err.code === 2) {
          setSearchError('Lokasi tidak tersedia. Pastikan GPS/WiFi aktif dan coba lagi.');
        } else if (err.code === 3) {
          setSearchError('Timeout mencari lokasi. Coba lagi atau periksa koneksi internet.');
        } else {
          setSearchError(`Gagal mendapatkan lokasi (error ${err.code}). Coba lagi.`);
        }
      },
      {
        timeout: 15000,
        enableHighAccuracy: false, // Use IP-based location for faster response on desktop
        maximumAge: 300000 // Cache location for 5 minutes
      }
    );
  }

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Map Content */}
      <div
        ref={mapContainer}
        className="w-full flex-1"
        style={{ height: '100%' }}
      />

      <style>{`
        .mapboxgl-canvas { width: 100% !important; height: 100% !important; display: block; }
        .mapboxgl-map { width: 100% !important; height: 100% !important; }
        .mapboxgl-ctrl-bottom-right { right: 10px !important; bottom: 80px !important; }
      `}</style>

      {/* Premium Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-white overflow-hidden"
          >
            {/* Animated Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-brand-orange/5 via-transparent to-red-500/5" />
            <div className="absolute inset-0">
              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-96 h-96 bg-brand-orange/10 rounded-full blur-[100px]"
                  animate={{
                    x: [Math.random() * 200 - 100, Math.random() * 200 - 100],
                    y: [Math.random() * 200 - 100, Math.random() * 200 - 100],
                  }}
                  transition={{
                    duration: 4 + i,
                    repeat: Infinity,
                    repeatType: "reverse",
                  }}
                  style={{ left: `${30 + i * 20}%`, top: `${20 + i * 30}%` }}
                />
              ))}
            </div>

            <motion.div className="text-center z-10">
              <motion.div
                animate={{ scale: [0.9, 1.1, 0.9] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <img src="/Logo Avenly - Color.png" alt="Avenly" className="h-24 w-auto mx-auto mb-6" />
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-zinc-600 text-sm font-bold uppercase tracking-widest"
              >
                Memuat Maps...
              </motion.p>
              {/* Loading dots */}
              <div className="flex justify-center gap-2 mt-4">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 bg-brand-orange rounded-full"
                    animate={{ scale: [0, 1, 0], opacity: [0, 1, 0] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Token Error */}
      {!isLoading && tokenError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-8 text-center bg-white/95 backdrop-blur-md rounded-3xl">
          <div className="max-w-sm space-y-4">
            <div className="w-16 h-16 bg-red-500/20 rounded-3xl flex items-center justify-center mx-auto border border-red-500/30">
              <MapPin className="w-8 h-8 text-red-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900 mb-2">Mapbox Token Bermasalah</h2>
              <p className="text-sm text-zinc-900/50 leading-relaxed">{tokenError}</p>
            </div>
            <button
              onClick={() => window.open('https://account.mapbox.com/access-tokens/', '_blank')}
              className="w-full bg-brand-orange text-zinc-900 py-3 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-brand-orange/90 transition-colors"
            >
              Dapatkan Public Token
            </button>
          </div>
        </div>
      )}

      {/* Active Navigation Mode - Full Screen */}
      <AnimatePresence>
        {routeState.isNavigating && routeState.routeGeometry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-20 flex flex-col pointer-events-none"
          >
            {/* Glassmorphism Top Bar */}
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="p-4 pt-8 pointer-events-auto"
            >
              <div className="bg-white/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/50 overflow-hidden">
                {/* Gradient Accent */}
                <div className="h-1.5 bg-gradient-to-r from-brand-orange via-red-500 to-brand-orange" />

                <div className="p-4 flex items-start justify-between gap-4">
                  {/* Compass & Direction */}
                  <motion.div
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex items-center gap-3"
                  >
                    {/* Animated Compass */}
                    <div className="relative w-14 h-14">
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-orange/20 to-red-500/20 animate-pulse" />
                      <div className="absolute inset-0 rounded-2xl bg-white flex items-center justify-center shadow-lg">
                        <div
                          className="transition-transform duration-300 ease-out"
                          style={{ transform: `rotate(-${userHeading}deg)` }}
                        >
                          <svg viewBox="0 0 60 60" className="w-10 h-10">
                            <circle cx="30" cy="30" r="28" fill="none" stroke="#f5f5f5" strokeWidth="2" />
                            <text x="30" y="10" textAnchor="middle" className="text-[8px] font-black fill-red-500">U</text>
                            <text x="50" y="33" textAnchor="middle" className="text-[7px] font-bold fill-zinc-400">T</text>
                            <text x="30" y="54" textAnchor="middle" className="text-[8px] font-black fill-zinc-400">S</text>
                            <text x="10" y="33" textAnchor="middle" className="text-[7px] font-bold fill-zinc-400">B</text>
                            <polygon points="30,10 26,22 30,18 34,22" className="fill-red-500" />
                            <polygon points="30,50 26,38 30,42 34,38" className="fill-zinc-300" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    {/* Direction */}
                    <div>
                      <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Arah</p>
                      <p className="text-base font-black text-black leading-tight">{getDirectionName(userHeading)}</p>
                    </div>
                  </motion.div>

                  {/* ETA & Time */}
                  <motion.div
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="text-right"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="inline-block"
                    >
                      <p className="text-brand-orange font-black text-3xl leading-none">{routeState.eta}</p>
                    </motion.div>
                    <p className="text-[9px] font-bold text-zinc-400 uppercase">menit</p>
                    <p className="text-[10px] font-bold text-zinc-500">{currentTime}</p>
                  </motion.div>
                </div>

                {/* Main Instruction */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="px-4 pb-4"
                >
                  <div className="bg-gradient-to-br from-zinc-50 to-white rounded-2xl p-4 flex items-center gap-4 border border-zinc-100">
                    {/* Maneuver Icon */}
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-orange to-red-500 flex items-center justify-center shadow-xl shadow-brand-orange/40 shrink-0"
                    >
                      <span className="text-2xl">{maneuverIcon}</span>
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black text-brand-orange uppercase tracking-widest mb-0.5">
                        {maneuverDistance} • {currentRoad || 'Jl. ...'}
                      </p>
                      <h2 className="text-xl font-black text-black leading-tight">
                        {currentInstruction || 'Mulai perjalanan'}
                      </h2>
                    </div>
                    {/* Distance Progress */}
                    <div className="shrink-0">
                      <div className="w-12 h-12 rounded-full border-4 border-zinc-100 flex items-center justify-center relative">
                        <svg className="w-full h-full -rotate-90">
                          <circle cx="24" cy="24" r="20" fill="none" stroke="#f5f5f5" strokeWidth="4" />
                          <circle
                            cx="24" cy="24" r="20" fill="none"
                            stroke="#f97316" strokeWidth="4"
                            strokeDasharray={`${(routeState.currentStepIndex / Math.max(routeState.steps, 1)) * 125.6} 125.6`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="absolute text-[10px] font-black text-zinc-600">
                          {routeState.currentStepIndex + 1}/{routeState.steps}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>

            {/* Progress Steps */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="px-4 mb-2 pointer-events-auto"
            >
              <div className="flex gap-1">
                {routeState.maneuvers.slice(0, 8).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-all origin-left",
                      i <= routeState.currentStepIndex ? "bg-gradient-to-r from-brand-orange to-red-500" : "bg-white/20"
                    )}
                  />
                ))}
                {routeState.maneuvers.length > 8 && (
                  <span className="text-[10px] text-white/60 self-center ml-2 font-bold">
                    +{routeState.maneuvers.length - 8}
                  </span>
                )}
              </div>
            </motion.div>

            {/* Spacer - Map visible here */}
            <div className="flex-1 pointer-events-none" />

            {/* Next Step Card */}
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, type: "spring" }}
              className="px-4 mb-2 pointer-events-auto"
            >
              <div className="bg-white/95 backdrop-blur-xl border border-zinc-100 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-brand-orange/10 flex items-center justify-center">
                  <ChevronRight className="w-4 h-4 text-brand-orange" />
                </div>
                <p className="text-xs text-zinc-500">
                  Selanjutnya: <span className="text-zinc-900 font-bold">{nextInstruction}</span>
                </p>
              </div>
            </motion.div>

            {/* Bottom Controls */}
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              transition={{ delay: 0.6, type: "spring" }}
              className="p-4 pointer-events-auto"
            >
              {/* Demo Arrival Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setShowArrival(true);
                  setArrivalDestination(routeState.destination?.full_address || routeState.destination?.place_name || 'Tujuan Anda');
                  const utterance = new SpeechSynthesisUtterance('Anda telah tiba di tujuan. Selamat sampai!');
                  utterance.lang = 'id-ID';
                  window.speechSynthesis?.speak(utterance);
                }}
                className="w-full mb-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white py-2 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-green-500/30"
              >
                <span>🎯</span> Simulasi Tiba
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={cancelNavigation}
                className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 shadow-xl shadow-red-500/30"
              >
                <X className="w-5 h-5" />
                Akhiri Navigasi
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🎉 Arrival Celebration Modal */}
      <AnimatePresence>
        {showArrival && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowArrival(false)}
          >
            <motion.div
              initial={{ scale: 0.5, y: 100, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.5, y: 100, opacity: 0 }}
              transition={{ type: "spring", stiffness: 100, damping: 15 }}
              className="bg-white rounded-3xl p-8 mx-6 max-w-sm w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Confetti/Success Animation */}
              <div className="relative">
                {/* Animated circles */}
                <motion.div
                  className="absolute -inset-4 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full opacity-20"
                  animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.3, 0.2] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <motion.div
                  className="absolute -inset-8 bg-gradient-to-br from-brand-orange to-red-500 rounded-full opacity-10"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
                  transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
                />

                {/* Checkmark icon */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.3, type: "spring" }}
                  className="relative w-24 h-24 mx-auto mb-6"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full shadow-xl shadow-green-500/50" />
                  <motion.svg
                    viewBox="0 0 24 24"
                    className="absolute inset-0 w-full h-full p-6"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                  >
                    <motion.path
                      d="M5 12l5 5L20 7"
                      fill="none"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ delay: 0.5, duration: 0.5 }}
                    />
                  </motion.svg>
                </motion.div>
              </div>

              {/* Text */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-center mb-6"
              >
                <h2 className="text-2xl font-black text-zinc-900 mb-2">
                  Anda Telah Tiba! 🎉
                </h2>
                <p className="text-sm text-zinc-500 font-medium">
                  {arrivalDestination}
                </p>
              </motion.div>

              {/* Stats */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="grid grid-cols-3 gap-4 mb-6"
              >
                <div className="text-center">
                  <p className="text-xl font-black text-brand-orange">{routeState.distance >= 1000 ? `${(routeState.distance / 1000).toFixed(1)}km` : `${routeState.distance}m`}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Jarak</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-brand-orange">{routeState.eta}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Menit</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-brand-orange">{routeState.currentStepIndex + 1}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Langkah</p>
                </div>
              </motion.div>

              {/* Safety Score */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 mb-6 border border-green-100"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                      <span className="text-white font-black text-sm">✓</span>
                    </div>
                    <div>
                      <p className="text-xs font-black text-green-600 uppercase">Perjalanan Aman</p>
                      <p className="text-[10px] text-green-500">Tanpa insiden bahaya</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-green-600">{routeState.safetyScore}%</p>
                    <p className="text-[9px] font-bold text-green-400">Safety Score</p>
                  </div>
                </div>
              </motion.div>

              {/* Buttons */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="space-y-3"
              >
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowArrival(false)}
                  className="w-full bg-gradient-to-r from-brand-orange to-red-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-brand-orange/40"
                >
                  Rute Baru
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setShowArrival(false);
                    cancelNavigation();
                  }}
                  className="w-full bg-zinc-100 text-zinc-600 py-3 rounded-xl font-bold text-xs uppercase tracking-wider"
                >
                  Tutup
                </motion.button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Bar - Hidden during navigation */}
      {!routeState.isNavigating && hasToken && !isLoading && (
        <div className="absolute top-4 left-4 right-4 z-10">
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-lg border border-zinc-200 overflow-hidden">
            {/* Search Input */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <Search className="text-zinc-400 w-5 h-5 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari lokasi tujuan..."
                className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-zinc-900 placeholder-zinc-400"
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearchQuery(''); setSuggestions([]); }
                }}
              />
              {searchLoading && (
                <div className="w-4 h-4 border-2 border-zinc-200 border-t-brand-orange rounded-full animate-spin shrink-0" />
              )}
              {/* My Location button */}
              {!searchQuery && !suggestions.length && (
                <button
                  onClick={locateMyPosition}
                  disabled={isLocating}
                  className={cn(
                    "shrink-0 p-1.5 rounded-xl transition-all",
                    isLocating
                      ? "text-brand-orange"
                      : "text-zinc-400 hover:text-brand-orange hover:bg-brand-orange/10"
                  )}
                  title="Deteksi lokasi saya"
                >
                  {isLocating ? (
                    <div className="w-4 h-4 border-2 border-brand-orange/30 border-t-brand-orange rounded-full animate-spin" />
                  ) : (
                    <Locate className="w-5 h-5" />
                  )}
                </button>
              )}
              {(searchQuery || suggestions.length > 0) && (
                <button
                  onClick={() => { setSearchQuery(''); setSuggestions([]); }}
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Suggestions */}
            <AnimatePresence>
              {(suggestions.length > 0 || searchLoading || searchError) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-zinc-200 overflow-hidden max-h-52 overflow-y-auto"
                >
                  {searchLoading && (
                    <div className="px-3 py-2 flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-zinc-200 border-t-brand-orange rounded-full animate-spin shrink-0" />
                      <span className="text-xs text-zinc-500">Mencari lokasi...</span>
                    </div>
                  )}
                  {searchError && !searchLoading && (
                    <div className="px-3 py-2 border-t border-zinc-200">
                      <p className="text-xs text-red-500">{searchError}</p>
                    </div>
                  )}
                  {!searchLoading && suggestions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => calculateRoute(s)}
                      className="w-full px-3 py-2.5 flex items-start gap-2 hover:bg-zinc-50 transition-colors text-left border-t border-zinc-200"
                    >
                      <MapPin className="w-3.5 h-3.5 text-brand-orange mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-900 leading-tight">{s.text}</p>
                        <p className="text-[10px] text-zinc-500 leading-tight">
                          {s.full_address || s.place_name.replace(s.text + ', ', '')}
                        </p>
                        {(s.city || s.region) && (
                          <p className="text-[9px] text-brand-orange font-medium mt-0.5">
                            {s.city}{s.region && s.city ? ', ' : ''}{s.region}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Route Preview */}
            {routeState.routeGeometry && !routeState.isNavigating && (
              <div className="border-t border-zinc-200">
                <div className="p-3 space-y-2">
                  {/* Origin */}
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    </div>
                    <div>
                      <p className="text-[9px] text-zinc-900/30 uppercase font-black tracking-widest">Asal</p>
                      <p className="text-[10px] text-zinc-900/70">Lokasi saya</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pl-3">
                    <div className="w-px h-3 border-l border-dashed border-zinc-300 ml-[-1px]" />
                    <ArrowRight className="w-3 h-3 text-brand-orange/60" />
                  </div>

                  {/* Destination */}
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-brand-orange/20 flex items-center justify-center shrink-0">
                      <MapPin className="w-3 h-3 text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-[9px] text-zinc-900/30 uppercase font-black tracking-widest">Tujuan</p>
                      <p className="text-[10px] font-medium text-zinc-900 leading-tight line-clamp-1">
                        {routeState.destination?.full_address || routeState.destination?.text}
                      </p>
                    </div>
                  </div>

                  {/* Route Stats */}
                  <div className="grid grid-cols-4 gap-1 pt-2 border-t border-zinc-200">
                    <div className="text-center">
                      <p className="text-sm font-black text-zinc-900">{formatDistance(routeState.distance)}</p>
                      <p className="text-[8px] text-zinc-900/30 uppercase font-black tracking-widest">Jarak</p>
                    </div>
                    <div className="text-center border-x border-zinc-200">
                      <p className="text-sm font-black text-zinc-900">{formatDuration(routeState.eta * 60)}</p>
                      <p className="text-[8px] text-zinc-900/30 uppercase font-black tracking-widest">Waktu</p>
                    </div>
                    <div className="text-center border-x border-zinc-200">
                      <p className="text-sm font-black text-zinc-900">{routeState.safetyScore}</p>
                      <p className="text-[8px] text-zinc-900/30 uppercase font-black tracking-widest">Safety</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-zinc-900">{routeState.steps}</p>
                      <p className="text-[8px] text-zinc-900/30 uppercase font-black tracking-widest">Langkah</p>
                    </div>
                  </div>

                  {/* Safety Badge */}
                  <div className={routeState.safetyScore >= 80 ? "bg-green-500/15 border border-green-500/30 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5" : routeState.safetyScore >= 60 ? "bg-yellow-500/15 border border-yellow-500/30 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5" : "bg-red-500/15 border border-red-500/30 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5"}>
                    <span className="text-xs">{routeState.safetyScore >= 80 ? "🟢" : routeState.safetyScore >= 60 ? "🟡" : "🔴"}</span>
                    <span className={routeState.safetyScore >= 80 ? "text-[10px] font-bold text-green-600" : routeState.safetyScore >= 60 ? "text-[10px] font-bold text-yellow-600" : "text-[10px] font-bold text-red-600"}>
                      {routeState.safetyLabel}
                    </span>
                    {routeState.hazardWarnings.length > 0 && (
                      <span className="text-[10px] text-zinc-500 ml-auto">
                        {routeState.hazardWarnings.length} peringatan
                      </span>
                    )}
                  </div>

                  {/* Hazard Warnings */}
                  {routeState.hazardWarnings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[8px] text-zinc-900/30 uppercase font-black tracking-widest">Peringatan di sepanjang rute:</p>
                      {routeState.hazardWarnings.slice(0, 2).map((w, i) => (
                        <div key={i} className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                          <span className="text-[10px]">⚠️</span>
                          <span className="text-[10px] text-zinc-900/70 flex-1">{w.name}</span>
                          <span className={w.severity === 'high' ? "text-[10px] font-bold text-red-600" : w.severity === 'medium' ? "text-[10px] font-bold text-yellow-600" : "text-[10px] font-bold text-orange-600"}>
                            {w.severity === 'high' ? 'Tinggi' : w.severity === 'medium' ? 'Sedang' : 'Rendah'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={resetRoute}
                      className="flex-1 py-2.5 rounded-xl font-bold text-xs text-zinc-900/60 bg-zinc-100 border border-zinc-200 flex items-center justify-center gap-1.5 hover:bg-zinc-200 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Batal
                    </button>
                    <button
                      onClick={startNavigation}
                      className="flex-[2] py-2.5 rounded-xl font-bold text-xs bg-brand-orange text-zinc-900 shadow-md flex items-center justify-center gap-1.5 hover:bg-brand-orange/90 transition-colors active:scale-95"
                    >
                      <NavIcon className="w-3.5 h-3.5 rotate-45" />
                      Mulai Navigasi
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Coordinates Debug */}
      {hasToken && !mapError && !routeState.isNavigating && (
        <div className="absolute bottom-32 left-4 bg-white/90 border border-zinc-200 px-3 py-1.5 rounded-xl text-xs text-zinc-500 z-10 shadow-sm">
          {lat.toFixed(4)}, {lng.toFixed(4)} • z{zoom.toFixed(1)}
        </div>
      )}
    </div>
  );
}

