import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { NavigationState } from '../types';
import { Navigation as NavIcon, Send, MapPin, Search, X, ArrowRight, ChevronRight, RotateCcw, Locate, Layers, Navigation2, Heart, Bookmark, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { subscribeToAlerts, auth, db } from '../lib/firebase';
import { RoadAlert } from '../lib/firebase';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const GEOFENCE_RADIUS_M = 120;
const OFF_ROUTE_THRESHOLD_M = 80;
const DEFAULT_CENTER: [number, number] = [107.3371, -6.3065];

interface GeocodingFeature {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
  context?: Array<{ id: string; text: string }>;
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
  // Alternative routes
  allRoutes: {
    geometry: GeoJSON.LineString;
    duration: number;
    distance: number;
    distance_km: string;
    eta_text: string;
    safetyScore: number;
    safetyLabel: string;
  }[];
  selectedRouteIndex: number;
}

const MANEUVER_ICONS: Record<string, string> = {
  depart: '🚀', turn: '↩️', merge: '↗️', 'on ramp': '🛣️',
  'off ramp': '↘️', fork: '↗️', 'end of road': '↩️',
  continue: '➡️', 'new name': '➡️', destination: '🏁',
  'destination reached': '✅', rotary: '🔄', roundabout: '🔄',
};

const DIRECTION_SUFFIX: Record<string, string> = {
  right: ' ke kanan', left: ' ke kiri', 'slight right': ' sedikit ke kanan',
  'slight left': ' sedikit ke kiri', sharp: ' tajam', straight: ' terus',
};

// ─────────────────────────────────────────────
// MATH UTILITIES
// ─────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function getBearing(from: [number, number], to: [number, number]): number {
  const dLon = (to[0] - from[0]) * Math.PI / 180;
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function isRateLimited(key: string, windowMs = 15000): boolean {
  const now = Date.now();
  const last = parseInt(sessionStorage.getItem(key) || '0', 10);
  if (now - last < windowMs) return true;
  sessionStorage.setItem(key, String(now));
  return false;
}

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

function getDirectionName(heading: number): string {
  const n = ((heading % 360) + 360) % 360;
  if (n >= 337.5 || n < 22.5) return 'Utara';
  if (n >= 22.5 && n < 67.5) return 'Timur Laut';
  if (n >= 67.5 && n < 112.5) return 'Timur';
  if (n >= 112.5 && n < 157.5) return 'Tenggara';
  if (n >= 157.5 && n < 202.5) return 'Selatan';
  if (n >= 202.5 && n < 247.5) return 'Barat Daya';
  if (n >= 247.5 && n < 292.5) return 'Barat';
  if (n >= 292.5 && n < 337.5) return 'Barat Laut';
  return 'Utara';
}

// Nearest point index on route for current user position
function nearestRouteIndex(coords: [number, number][], lng: number, lat: number): number {
  let minDist = Infinity, idx = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineM([coords[i][0], coords[i][1]], [lng, lat]);
    if (d < minDist) { minDist = d; idx = i; }
  }
  return idx;
}

// Get SVG arrow path for a maneuver bearing
function getArrowSVG(type: string, modifier?: string): string {
  let rotation = 0;
  const lowerType = type.toLowerCase();
  const lowerMod = (modifier || '').toLowerCase();
  if (lowerType === 'turn') {
    if (lowerMod === 'right') rotation = -45;
    else if (lowerMod === 'left') rotation = 45;
    else if (lowerMod === 'slight right') rotation = -20;
    else if (lowerMod === 'slight left') rotation = 20;
    else if (lowerMod === 'sharp right') rotation = -70;
    else if (lowerMod === 'sharp left') rotation = 70;
  } else if (lowerType === 'merge' || lowerType === 'on ramp' || lowerType === 'off ramp') {
    rotation = 30;
  } else if (lowerType === 'roundabout' || lowerType === 'rotary') {
    rotation = 90;
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><g transform="rotate(${rotation},20,20)"><polygon points="20,4 30,28 20,22 10,28" fill="#ffffff" stroke="#f97316" stroke-width="2"/><polygon points="20,28 30,28 20,36" fill="#f97316"/></g></svg>`)}`;
}

// ─────────────────────────────────────────────
// PRESET LOCATIONS
// ─────────────────────────────────────────────
const KARAWANG_PRESETS: GeocodingFeature[] = [
  { id: 'horizon-university', place_name: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass No.KM.1, Tanjungpura, Karawang Bar., Karawang, Jawa Barat 41316', center: [107.2926, -6.2892], text: 'Horizon University Indonesia', full_address: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass KM.1, Tanjungpura, Karawang Barat, Jawa Barat 41316', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat', postcode: '41316' },
  { id: 'rs-karawang', place_name: 'RSUP Karawang, Jl. Galuh No.1, Nagasari, Karawang Bar., Karawang, Jawa Barat 41312', center: [107.3170, -6.3060], text: 'RSUP Karawang', full_address: 'RSUP Karawang, Jl. Galuh No.1, Nagasari, Karawang Barat, Jawa Barat 41312', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat', postcode: '41312' },
  { id: 'tol-karawang-barat', place_name: 'Gerbang Tol Karawang Barat, Trans Jawa Highway, Karawang, Jawa Barat', center: [107.3450, -6.2930], text: 'Gerbang Tol Karawang Barat', full_address: 'Gerbang Tol Karawang Barat, Jalan Tol Trans Jawa, Karawang, Jawa Barat', district: 'Karawang Timur', city: 'Karawang', region: 'Jawa Barat' },
  { id: 'mall-karawang', place_name: 'Resvi City Mall Karawang, Jl. Tuparev, Nagarasari, Karawang Bar., Karawang, Jawa Barat 41312', center: [107.3110, -6.3150], text: 'Resvi City Mall Karawang', full_address: 'Resvi City Mall Karawang, Jl. Tuparev No.88, Nagarasari, Karawang Barat, Jawa Barat 41312', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat', postcode: '41312' },
  { id: 'alun-alun-karawang', place_name: 'Alun-Alun Karawang, Jl. Jend. A.Yani, Nagasari, Karawang Bar., Karawang, Jawa Barat 41311', center: [107.3070, -6.3090], text: 'Alun-Alun Karawang', full_address: 'Alun-Alun Karawang, Jl. Jend. Ahmad Yani, Nagasari, Karawang Barat, Jawa Barat 41311', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat', postcode: '41311' },
  { id: 'stadt-celebes-karawang', place_name: 'Stadt Celebes Hotel Karawang, Jl. Pangkal Perjuangan, Tanjungpura, Karawang Bar., Karawang, Jawa Barat 41316', center: [107.2870, -6.2860], text: 'Stadt Celebes Hotel', full_address: 'Stadt Celebes Hotel Karawang, Jl. Pangkal Perjuangan By Pass, Tanjungpura, Karawang Barat, Jawa Barat 41316', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat', postcode: '41316' },
  { id: 'citra-insight-karawang', place_name: 'Citra Insight Technology, Jl. Pangkal Perjuangan By Pass KM.1,8, Tanjungpura, Karawang Bar., Karawang, Jawa Barat 41316', center: [107.2960, -6.2915], text: 'Citra Insight Technology', full_address: 'Citra Insight Technology, Jl. Pangkal Perjuangan By Pass KM.1,8, Tanjungpura, Karawang Barat, Jawa Barat 41316', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat', postcode: '41316' },
  { id: 'tol-karawang-timur', place_name: 'Gerbang Tol Karawang Timur, Trans Jawa Highway, Karawang, Jawa Barat', center: [107.2650, -6.3250], text: 'Gerbang Tol Karawang Timur', full_address: 'Gerbang Tol Karawang Timur, Jalan Tol Trans Jawa, Karawang, Jawa Barat', district: 'Karawang Timur', city: 'Karawang', region: 'Jawa Barat' },
  { id: 'kln-karawang', place_name: 'KLN Karawang - Kawasan industri Ngury, Telagasari, Karawang, Jawa Barat', center: [107.3500, -6.3500], text: 'Kawasan Industri Karawang', full_address: 'Kawasan Industri Ngury, Telagasari, Karawang, Jawa Barat 41381', district: 'Telagasari', city: 'Karawang', region: 'Jawa Barat', postcode: '41381' },
  { id: 'stt-karawang', place_name: 'STT Bandung - kampus II Karawang, Jl. Pangkal Perjuangan By Pass KM.2, Tanjungpura, Karawang Bar., Karawang, Jawa Barat', center: [107.2850, -6.2855], text: 'STT Bandung - Kampus II Karawang', full_address: 'STT Bandung (Kampus II Karawang), Jl. Pangkal Perjuangan By Pass KM.2, Tanjungpura, Karawang Barat, Jawa Barat', district: 'Karawang Barat', city: 'Karawang', region: 'Jawa Barat' },
];

function translateManeuver(instruction?: string, modifier?: string, wayName?: string, distance?: number): string {
  if (!instruction) return 'Lanjutkan perjalanan';
  const lower = instruction.toLowerCase();
  let suffix = modifier ? (DIRECTION_SUFFIX[modifier.toLowerCase()] || '') : '';
  const roadContext = wayName ? ` di ${wayName}` : '';
  if (lower.includes('depart')) return 'Mulai perjalanan' + roadContext;
  if (lower.includes('arrive') || lower.includes('destination')) return 'Anda telah tiba di tujuan';
  if (lower.includes('continue')) return distance !== undefined && distance > 500 ? `Terus${suffix} ${formatDistance(distance)}` + roadContext : `Lanjutkan${suffix}${roadContext}`;
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

export default function MapboxView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const userLocationMarker = useRef<mapboxgl.Marker | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const progressMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const maneuverMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const offRouteBannerRef = useRef<HTMLDivElement>(null);
  const routeLayerAddedRef = useRef(false);
  const altRoutesLayerAddedRef = useRef(false);
  const alertMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // Smoothing state
  const smoothTargetRef = useRef({ lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1], bearing: 0 });
  const smoothCurrentRef = useRef({ lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1], bearing: 0 });
  const animFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const lastVoiceTimeRef = useRef<number>(0);
  const lastSpokenStepRef = useRef<number>(-1);
  const prevLngRef = useRef<number>(0);
  const prevLatRef = useRef<number>(0);

  const [lng, setLng] = useState(DEFAULT_CENTER[0]);
  const [lat, setLat] = useState(DEFAULT_CENTER[1]);
  const [zoom, setZoom] = useState(13);
  const [hasToken, setHasToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [mapError, setMapError] = useState('');
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
  const [alerts, setAlerts] = useState<RoadAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(true);
  const [isRecenterNeeded, setIsRecenterNeeded] = useState(false);

  // Navigation feature states
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [isReRouting, setIsReRouting] = useState(false);
  const [showAltRoutes, setShowAltRoutes] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const [isNorthLocked, setIsNorthLocked] = useState(false);
  const [routeProgress, setRouteProgress] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const isCalculatingRouteRef = useRef(false);

  const [routeState, setRouteState] = useState<RouteState>({
    isNavigating: false, origin: null, destination: null, routeGeometry: null,
    maneuvers: [], currentStepIndex: 0, eta: 0, distance: 0, steps: 0,
    safetyScore: 100, safetyLabel: 'Sangat Aman', hazardWarnings: [],
    maneuverCoords: [], allRoutes: [], selectedRouteIndex: 0,
  });

  // ─── Clock ───
  useEffect(() => {
    const updateClock = () => setCurrentTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, []);

  // ─── Token validation ───
  useEffect(() => {
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('your_mapbox_token')) {
      setTokenError('Token tidak ditemukan. Set VITE_MAPBOX_ACCESS_TOKEN di .env');
      setIsLoading(false); return;
    }
    if (MAPBOX_TOKEN.startsWith('sk.')) {
      setTokenError('Gunakan Public Token (pk.), bukan Secret Key (sk.)');
      setIsLoading(false); return;
    }
    if (!MAPBOX_TOKEN.startsWith('pk.')) {
      setTokenError('Token tidak valid. Harus dimulai dengan "pk."');
      setIsLoading(false); return;
    }
    setHasToken(true);
  }, []);

  // ─── Road Alerts from Firestore ───
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = subscribeToAlerts((newAlerts) => {
      setAlerts(newAlerts);
    });
    return unsubscribe;
  }, []);

  // ─── Geolocation ───
  useEffect(() => {
    if (!navigator.geolocation) { setLocationPermission('denied'); return; }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude, lat = pos.coords.latitude;
        if (lng >= 95 && lng <= 141 && lat >= -11 && lat <= 6) {
          smoothTargetRef.current = { lng, lat, bearing: pos.coords.heading || 0 };
          smoothCurrentRef.current = { lng, lat, bearing: pos.coords.heading || 0 };
          setCurrentLocation([lng, lat]); setLng(lng); setLat(lat);
          setLocationPermission('granted');
        }
      },
      () => setLocationPermission('denied'),
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 60000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude, lat = pos.coords.latitude, heading = pos.coords.heading;
        if (!(lng >= 95 && lng <= 141 && lat >= -11 && lat <= 6)) return;
        if (Math.abs(lng - prevLngRef.current) < 1e-9 && Math.abs(lat - prevLatRef.current) < 1e-9) return;
        prevLngRef.current = lng; prevLatRef.current = lat;
        smoothTargetRef.current = { lng, lat, bearing: !isNaN(heading!) && heading !== null ? heading : smoothTargetRef.current.bearing };
        setCurrentLocation([lng, lat]); setLng(lng); setLat(lat);
        if (!isNaN(heading!) && heading !== null) setUserHeading(heading);
        setLocationPermission('granted');
      },
      () => {},
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ─── SINGLE RAF ANIMATION LOOP ───
  useEffect(() => {
    if (!isMapLoaded || !mapInstance.current) return;

    const map = mapInstance.current;
    const SMOOTH_FACTOR = 0.08;

    let rafId: number;
    function tick(now: number) {
      const dt = lastFrameTimeRef.current ? Math.min((now - lastFrameTimeRef.current) / 16.667, 3) : 1;
      lastFrameTimeRef.current = now;

      const target = smoothTargetRef.current;
      const current = smoothCurrentRef.current;

      current.lng += (target.lng - current.lng) * SMOOTH_FACTOR * dt;
      current.lat += (target.lat - current.lat) * SMOOTH_FACTOR * dt;

      let dB = target.bearing - current.bearing;
      if (dB > 180) dB -= 360;
      if (dB < -180) dB += 360;
      current.bearing += dB * SMOOTH_FACTOR * dt;

      // Update user location marker
      userLocationMarker.current?.setLngLat([current.lng, current.lat]);

      // Progress marker along route
      if (routeState.routeGeometry && routeState.isNavigating) {
        const coords = routeState.routeGeometry.coordinates as [number, number][];
        const ni = nearestRouteIndex(coords, current.lng, current.lat);
        const progress = ni / Math.max(coords.length - 1, 1);
        setRouteProgress(progress);
        if (progressMarkerRef.current) {
          const pt = coords[Math.min(ni, coords.length - 1)];
          const nextPt = coords[Math.min(ni + 1, coords.length - 1)];
          const b = getBearing(pt, nextPt);
          progressMarkerRef.current.setLngLat(pt);
          const el = progressMarkerRef.current.getElement();
          el.style.transform = `rotate(${b}deg)`;
        }
      }

      // Navigation camera
      if (routeState.isNavigating) {
        let navBearing = current.bearing;
        if (!navBearing || navBearing === 0) {
          const nextIdx = routeState.currentStepIndex + 1;
          const maneuverTarget = routeState.maneuverCoords[nextIdx];
          if (maneuverTarget) {
            navBearing = getBearing([current.lng, current.lat], maneuverTarget);
          } else if (routeState.routeGeometry && routeState.routeGeometry.coordinates.length > 1) {
            const coords = routeState.routeGeometry.coordinates as [number, number][];
            const ni = nearestRouteIndex(coords, current.lng, current.lat);
            const aheadCoord = coords[Math.min(ni + 1, coords.length - 1)];
            navBearing = getBearing([current.lng, current.lat], aheadCoord);
          }
        }

        if (!isNorthLocked && isRecenterNeeded) {
          map.easeTo({
            center: [current.lng, current.lat],
            bearing: navBearing,
            zoom: 17, pitch: 60, duration: 300,
            easing: easeOutCubic,
          });
          setIsRecenterNeeded(false);
        }
      }

      // Off-route detection
      if (routeState.isNavigating && routeState.routeGeometry && !isReRouting) {
        const coords = routeState.routeGeometry.coordinates as [number, number][];
        const ni = nearestRouteIndex(coords, current.lng, current.lat);
        const nearestDist = haversineM([current.lng, current.lat], coords[ni]);
        const wasOff = isOffRoute;
        const nowOff = nearestDist > OFF_ROUTE_THRESHOLD_M;
        if (nowOff !== wasOff) {
          setIsOffRoute(nowOff);
          if (nowOff) {
            const utt = new SpeechSynthesisUtterance('Anda keluar dari rute. Mencari rute ulang...');
            utt.lang = 'id-ID'; utt.rate = 1.1;
            window.speechSynthesis?.speak(utt);
            handleReRoute(currentLocationRef.current, routeState.destination?.center || DEFAULT_CENTER);
          }
        }
      }

      // Voice geofence + step advancement
      if (routeState.isNavigating && routeState.maneuverCoords.length > 0) {
        const nextIdx = routeState.currentStepIndex + 1;
        const nextCoord = routeState.maneuverCoords[nextIdx];
        if (nextCoord) {
          const distM = haversineM([current.lng, current.lat], nextCoord);
          const nowTime = Date.now();
          if (distM <= GEOFENCE_RADIUS_M && nextIdx !== lastSpokenStepRef.current && nowTime - lastVoiceTimeRef.current > 4000) {
            lastSpokenStepRef.current = nextIdx;
            lastVoiceTimeRef.current = nowTime;
            const m = routeState.maneuvers[nextIdx];
            if (m) {
              const text = translateManeuver(m.instruction, m.modifier, m.way_name);
              const u = new SpeechSynthesisUtterance(text);
              u.lang = 'id-ID'; u.rate = 1.15;
              window.speechSynthesis?.speak(u);
            }
            setRouteState(prev => ({ ...prev, currentStepIndex: nextIdx }));
          }
        }
        // Arrival
        const destCoord = routeState.maneuverCoords[routeState.maneuverCoords.length - 1];
        if (destCoord) {
          const distM = haversineM([current.lng, current.lat], destCoord);
          if (distM <= GEOFENCE_RADIUS_M) {
            const utt = new SpeechSynthesisUtterance('Anda telah tiba di tujuan. Selamat sampai!');
            utt.lang = 'id-ID'; utt.rate = 1.0;
            window.speechSynthesis?.speak(utt);
            setShowArrival(true);
            setArrivalDestination(routeState.destination?.full_address || routeState.destination?.place_name || 'Tujuan');
            setRouteState(prev => ({ ...prev, isNavigating: false }));
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    animFrameRef.current = rafId;
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [isMapLoaded, routeState.isNavigating, routeState.currentStepIndex, routeState.maneuverCoords, routeState.maneuvers, routeState.destination, routeState.routeGeometry, isOffRoute, isReRouting, isNorthLocked, isRecenterNeeded]);

  // ─── Auto re-route ───
  async function handleReRoute(origin: [number, number], destination: [number, number]) {
    if (isReRouting) return;
    setIsReRouting(true);
    try {
      const res = await fetch('/api/directions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      });
      if (!res.ok) throw new Error('DIRECTIONS_UNAVAILABLE');
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const steps = route.legs?.[0]?.steps || [];
        const maneuverCoords: [number, number][] = steps.map((s: any) => {
          const loc = s.maneuver?.location ?? s.location ?? s.intersections?.[0]?.location ?? null;
          return (loc ? [loc[0], loc[1]] : origin) as [number, number];
        });
        const mappedManeuvers: Maneuver[] = steps.map((s: any) => ({
          instruction: s.maneuver?.instruction ?? 'Lanjutkan',
          distance: s.distance ?? 0, duration: s.duration ?? 0,
          type: s.maneuver?.type ?? 'unknown', modifier: s.maneuver?.modifier,
          way_name: s.name ?? '',
        }));
        setRouteState(prev => ({
          ...prev,
          routeGeometry: route.geometry,
          maneuvers: mappedManeuvers,
          currentStepIndex: 0,
          eta: Math.round(route.duration / 60),
          distance: Math.round(route.distance),
          steps: steps.length,
          safetyScore: route.safetyScore ?? 100,
          safetyLabel: data.safetySummary?.label ?? 'Sangat Aman',
          hazardWarnings: route.hazardWarnings ?? [],
          maneuverCoords,
          allRoutes: data.routes.map((r: any) => ({
            geometry: r.geometry, duration: r.duration, distance: r.distance,
            distance_km: r.distance_km, eta_text: r.eta_text,
            safetyScore: r.safetyScore ?? 100,
            safetyLabel: data.safetySummary?.label ?? 'Sangat Aman',
          })),
        }));
        setIsOffRoute(false);
      }
    } catch {
      // silent fail — user can manually reset
    } finally {
      setIsReRouting(false);
    }
  }

  // ─── Map init ───
  useEffect(() => {
    if (!hasToken || mapInstance.current || !mapContainer.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainer.current!,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: currentLocation, zoom: 14, pitch: 0, bearing: 0,
      attributionControl: false,
    });

    map.on('load', () => {
      setIsLoading(false); setIsMapLoaded(true);

      // User location marker
      const el = document.createElement('div');
      el.style.cssText = 'width:20px;height:20px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 0 0 rgba(59,130,246,0.4);animation:pulse 2s infinite;cursor:pointer;';
      const style = document.createElement('style');
      style.textContent = '@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4)}70%{box-shadow:0 0 0 12px rgba(59,130,246,0)}100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}}';
      document.head.appendChild(style);
      userLocationMarker.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(currentLocation).addTo(map);

      // Progress marker (hidden until navigation starts)
      const progEl = document.createElement('div');
      progEl.style.cssText = 'width:28px;height:28px;background:#f97316;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(249,115,22,0.6);display:flex;align-items:center;justify-content:center;transition:transform 0.3s ease;';
      progEl.innerHTML = '<div style="width:8px;height:8px;background:white;border-radius:50%;"></div>';
      progressMarkerRef.current = new mapboxgl.Marker({ element: progEl, anchor: 'center' }).addTo(map);
      progressMarkerRef.current.getElement().style.display = 'none';

      mapInstance.current = map;
    });

    map.on('error', (e) => { setMapError(e.error?.message || 'Map failed'); setIsLoading(false); });
    map.on('move', () => {
      setLng(Number(map.getCenter().lng.toFixed(4)));
      setLat(Number(map.getCenter().lat.toFixed(4)));
      setZoom(Number(map.getZoom().toFixed(2)));
    });
    map.on('dragstart', () => {
      if (routeState.isNavigating) setIsRecenterNeeded(false);
    });
    map.on('resize', () => {
      // ensure layers re-evaluate on resize
      if (routeLayerAddedRef.current && map.getSource('route-source')) {
        const src = map.getSource('route-source') as mapboxgl.GeoJSONSource;
        const g = routeState.routeGeometry;
        if (g) src.setData({ type: 'Feature', geometry: g, properties: {} });
      }
    });

    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, [hasToken]);

  // ─── Toggle traffic layer ───
  const toggleTraffic = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    const next = !showTraffic;
    setShowTraffic(next);
    if (next) {
      map.addSource('traffic-source', {
        id: 'traffic',
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-traffic-v1',
      } as any);
      map.addLayer({ id: 'traffic-layer', type: 'circle', source: 'traffic', 'source-layer': 'traffic', paint: { 'circle-color': '#ff0000', 'circle-radius': 3, 'circle-opacity': 0.7 } });
    } else {
      if (map.getLayer('traffic-layer')) map.removeLayer('traffic-layer');
      if (map.getSource('traffic-source')) map.removeSource('traffic-source');
    }
  }, [showTraffic]);

  // ─── Route rendering ───
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !isMapLoaded) return;

    function cleanup() {
      try {
        ['route-layer', 'route-glow', 'route-center', 'route-casing', 'alt-route-0', 'alt-route-1'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource('route-source')) map.removeSource('route-source');
        if (map.getSource('alt-route-source')) map.removeSource('alt-route-source');
        routeLayerAddedRef.current = false;
        altRoutesLayerAddedRef.current = false;
      } catch {}
    }

    // Remove maneuver markers
    maneuverMarkersRef.current.forEach(m => m.remove());
    maneuverMarkersRef.current = [];

    if (!routeState.routeGeometry) { cleanup(); return; }

    // Origin marker
    if (routeState.origin) {
      if (originMarkerRef.current) originMarkerRef.current.remove();
      const oEl = document.createElement('div');
      oEl.style.cssText = 'width:32px;height:32px;background:#3b82f6;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(59,130,246,0.6);';
      oEl.innerHTML = '<div style="width:8px;height:8px;background:white;border-radius:50%;"></div>';
      originMarkerRef.current = new mapboxgl.Marker({ element: oEl, anchor: 'center' }).setLngLat(routeState.origin).addTo(map);
    }

    // Destination pin
    if (routeState.destination) {
      if (destMarkerRef.current) destMarkerRef.current.remove();
      const dEl = document.createElement('div');
      dEl.style.cssText = 'width:40px;height:52px;background:none;cursor:pointer;';
      dEl.innerHTML = `<svg width="40" height="52" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 0C8.954 0 0 8.954 0 20c0 14.5 20 32 20 32s20-17.5 20-32C40 8.954 31.046 0 20 0z" fill="#f97316"/><circle cx="20" cy="18" r="8" fill="white"/><circle cx="20" cy="18" r="4" fill="#f97316"/></svg>`;
      destMarkerRef.current = new mapboxgl.Marker({ element: dEl, anchor: 'bottom' }).setLngLat(routeState.destination.center).addTo(map);
    }

    // Draw maneuver arrow markers (every 3rd maneuver for clean look)
    if (routeState.maneuvers.length > 0) {
      const step = Math.max(1, Math.floor(routeState.maneuvers.length / 8));
      for (let i = 1; i < routeState.maneuvers.length - 1; i += step) {
        const coord = routeState.maneuverCoords[i];
        if (!coord) continue;
        const m = routeState.maneuvers[i];
        const arrowEl = document.createElement('div');
        arrowEl.style.cssText = 'width:36px;height:36px;cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));';
        arrowEl.innerHTML = `<img src="${getArrowSVG(m?.type || 'continue', m?.modifier)}" width="36" height="36" alt="maneuver" />`;
        const marker = new mapboxgl.Marker({ element: arrowEl, anchor: 'center' }).setLngLat(coord).addTo(map);
        maneuverMarkersRef.current.push(marker);
      }
    }

    try {
      cleanup();

      if (!map.loaded()) {
        map.once('load', () => addRouteLayer(map));
      } else {
        addRouteLayer(map);
      }
    } catch (error) {
      console.error('❌ Route rendering error:', error);
    }

    function addRouteLayer(map: mapboxgl.Map) {
      map.addSource('route-source', {
        type: 'geojson',
        data: { type: 'Feature', geometry: routeState.routeGeometry!, properties: {} },
      });

      // Casing
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route-source', paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.6 } });
      // Glow
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route-source', paint: { 'line-color': '#f97316', 'line-width': 8, 'line-opacity': 0.3, 'line-blur': 3 } });
      // Main white line
      map.addLayer({ id: 'route-layer', type: 'line', source: 'route-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 5 } });
      // Orange center
      map.addLayer({ id: 'route-center', type: 'line', source: 'route-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f97316', 'line-width': 2.5 } });

      // Alt routes (grayed out)
      if (showAltRoutes && routeState.allRoutes.length > 1) {
        const altRoutes = routeState.allRoutes.slice(1).map((r, i) => ({
          type: 'Feature' as const,
          geometry: r.geometry,
          properties: { altIndex: i + 1 },
        }));
        map.addSource('alt-route-source', { type: 'geojson', data: { type: 'FeatureCollection', features: altRoutes } });
        map.addLayer({ id: 'alt-route-0', type: 'line', source: 'alt-route-source', filter: ['==', ['get', 'altIndex'], 1], paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-opacity': 0.5, 'line-dasharray': [4, 2] } });
        altRoutesLayerAddedRef.current = true;
      }

      // Fit map: show full route with user at bottom, bearing aligned to route direction
      const coords = routeState.routeGeometry!.coordinates as [number, number][];
      const userLngLat = routeState.origin ?? currentLocation;
      if (coords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const c of coords) bounds.extend([c[0], c[1]] as [number, number]);
        const secondCoord = coords[1] ?? coords[0];
        const targetBearing = getBearing(userLngLat, secondCoord);
        map.fitBounds(bounds, { padding: { top: 100, bottom: 280, left: 60, right: 60 }, pitch: 40, bearing: targetBearing, duration: 1500 });
        console.log('✅ Route fit: bearing=' + targetBearing.toFixed(0) + '°');
      }

      // Show/hide progress marker
      if (progressMarkerRef.current) {
        progressMarkerRef.current.getElement().style.display = routeState.isNavigating ? 'flex' : 'none';
      }

      routeLayerAddedRef.current = true;
    }
  }, [routeState.routeGeometry, routeState.origin, routeState.destination, isMapLoaded, showAltRoutes]);

  // Update route source when route changes (without full re-render)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !routeLayerAddedRef.current || !routeState.routeGeometry) return;
    const src = map.getSource('route-source') as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData({ type: 'Feature', geometry: routeState.routeGeometry, properties: {} });
  }, [routeState.routeGeometry]);

  // ─── Road Alert Markers ───
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !isMapLoaded) return;

    // Clear existing markers
    alertMarkersRef.current.forEach(m => m.remove());
    alertMarkersRef.current = [];

    if (!showAlerts || alerts.length === 0) return;

    const ALERT_CONFIG: Record<string, { color: string; emoji: string; size: number }> = {
      accident: { color: '#ef4444', emoji: '🚨', size: 36 },
      pothole: { color: '#f97316', emoji: '🕳️', size: 30 },
      flood: { color: '#3b82f6', emoji: '🌊', size: 34 },
      traffic: { color: '#eab308', emoji: '🚗', size: 28 },
      other: { color: '#8b5cf6', emoji: '⚠️', size: 30 },
    };

    alerts.forEach(alert => {
      const lat = (alert.coordinates as any).latitude ?? (alert.coordinates as any).lat;
      const lng = (alert.coordinates as any).longitude ?? (alert.coordinates as any).lng;
      if (!lat || !lng) return;

      const config = ALERT_CONFIG[alert.type] || ALERT_CONFIG.other;
      const el = document.createElement('div');
      el.style.cssText = `width:${config.size}px;height:${config.size}px;cursor:pointer;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5));transition:transform 0.2s;`;
      el.innerHTML = `<div style="font-size:${config.size * 0.6}px;line-height:1;text-align:center;">${config.emoji}</div>`;
      el.title = `${alert.type.toUpperCase()} — ${alert.description || 'Tanpa deskripsi'}`;

      el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.3)'; });
      el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      alertMarkersRef.current.push(marker);
    });

    return () => {
      alertMarkersRef.current.forEach(m => m.remove());
      alertMarkersRef.current = [];
    };
  }, [alerts, showAlerts, isMapLoaded]);
  function startNavigation() {
    const map = mapInstance.current;
    const coords = routeState.routeGeometry?.coordinates as [number, number][];

    // Calculate initial bearing toward first turn on route
    let initialBearing = 0;
    if (routeState.maneuverCoords[0] && routeState.origin) {
      initialBearing = getBearing(routeState.origin, routeState.maneuverCoords[0]);
    } else if (coords && coords.length > 1) {
      initialBearing = getBearing(coords[0], coords[1]);
    }

    if (map) {
      // Stage 1: fly camera to user + initial route direction, THEN start navigation
      map.easeTo({
        center: currentLocation,
        bearing: initialBearing,
        zoom: 17,
        pitch: 60,
        duration: 800,
        easing: easeOutCubic,
      });

      // Stage 2: set isNavigating=true after camera reaches destination
      setTimeout(() => setRouteState(prev => ({ ...prev, isNavigating: true })), 100);
      setIsNorthLocked(false);
      setIsRecenterNeeded(true);
    } else {
      // Fallback if map not ready
      setRouteState(prev => ({ ...prev, isNavigating: true }));
    }

    console.log('🗺️ Navigation started: bearing=' + initialBearing.toFixed(0) + '°, zoom=17');
  }

  // ─── Cancel navigation ───
  function cancelNavigation() {
    const map = mapInstance.current;
    if (map) map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    if (progressMarkerRef.current) progressMarkerRef.current.getElement().style.display = 'none';
    setRouteState(prev => ({ ...prev, isNavigating: false, currentStepIndex: 0 }));
    setIsRecenterNeeded(false);
    setIsOffRoute(false); setIsNorthLocked(false);
  }

  // ─── Reset route ───
  function resetRoute() {
    cancelNavigation();
    const map = mapInstance.current;
    if (map) {
      try {
        ['route-layer', 'route-glow', 'route-center', 'route-casing', 'alt-route-0'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource('route-source')) map.removeSource('route-source');
        if (map.getSource('alt-route-source')) map.removeSource('alt-route-source');
      } catch {}
    }
    maneuverMarkersRef.current.forEach(m => m.remove()); maneuverMarkersRef.current = [];
    originMarkerRef.current?.remove(); originMarkerRef.current = null;
    destMarkerRef.current?.remove(); destMarkerRef.current = null;
    if (progressMarkerRef.current) progressMarkerRef.current.getElement().style.display = 'none';
    routeLayerAddedRef.current = false; altRoutesLayerAddedRef.current = false;
    setRouteState({ isNavigating: false, origin: null, destination: null, routeGeometry: null, maneuvers: [], currentStepIndex: 0, eta: 0, distance: 0, steps: 0, safetyScore: 100, safetyLabel: 'Sangat Aman', hazardWarnings: [], maneuverCoords: [], allRoutes: [], selectedRouteIndex: 0 });
    setSearchQuery(''); setSuggestions([]); setShowAltRoutes(false); setIsOffRoute(false);
  }

  // ─── Search ───
  const searchPlaces = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestions(locationPermission === 'granted' ? [] : KARAWANG_PRESETS.slice(0, 5)); return;
    }
    setSearchLoading(true); setSearchError('');
    try {
      const locationAtCall = currentLocationRef.current;
      const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=id&language=id&types=poi,address,place,locality,neighborhood&proximity=${locationAtCall[0]},${locationAtCall[1]}&limit=10`;
      const res = await fetch(mapboxUrl);
      const data = await res.json();
      if (data.message) { setSearchError(data.message); return; }
      let results: GeocodingFeature[] = [];
      if (query.toLowerCase().includes('horizon')) {
        results.push({ id: 'horizon-university-karawang', place_name: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass No.KM.1, Tanjungpura, Karawang Bar., Karawang, Jawa Barat 41316', center: [107.2926, -6.2892], text: 'Horizon University Indonesia', full_address: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass KM.1, Tanjungpura, Karawang Barat, Jawa Barat 41316', city: 'Karawang', region: 'Jawa Barat' });
      }
      const q = query.toLowerCase();
      const filtered = KARAWANG_PRESETS.filter(p => p.text.toLowerCase().includes(q) || (p.full_address || '').toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q));
      results = [...results, ...filtered];
      if (data.features?.length) {
        const presetIds = new Set(results.map(r => r.id));
        const newResults = (data.features as GeocodingFeature[]).filter(f => !presetIds.has(f.id));
        results = [...results, ...newResults];
      }
      setSuggestions(results.length ? results : []);
      if (!results.length) setSearchError('Tidak ada hasil. Coba kata kunci lain.');
    } catch {
      const q = query.toLowerCase();
      const filtered = KARAWANG_PRESETS.filter(p => p.text.toLowerCase().includes(q) || (p.full_address || '').toLowerCase().includes(q));
      setSuggestions(filtered.length ? filtered : []);
      if (!filtered.length) setSearchError('Gagal mencari. Cek koneksi internet.');
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isCalculatingRouteRef.current) { isCalculatingRouteRef.current = false; return; }
    const timer = setTimeout(() => { if (searchQuery.trim()) searchPlaces(searchQuery); }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchPlaces]);

  // ─── Calculate route ───
  async function calculateRoute(dest: GeocodingFeature) {
    isCalculatingRouteRef.current = true;
    setSearchQuery(dest.full_address || dest.place_name);
    setSearchError(''); setSuggestions([]); setShowAltRoutes(false);

    if (locationPermission !== 'granted') { setSearchError('Izinkan lokasi untuk menghitung rute dari posisi Anda'); return; }
    const origin: [number, number] = currentLocation;

    if (isRateLimited('mv_route_call', 5000)) { setSearchError('Tunggu beberapa detik sebelum mencari rute lain.'); return; }

    try {
      const res = await fetch('/api/directions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination: dest.center }),
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 402 || err.code === 'DIRECTIONS_UNAVAILABLE') {
          setSearchError('Navigasi tidak tersedia. Token Mapbox Anda perlu upgrade untuk akses Directions API.');
        } else if (err.error?.includes('too long') || err.error?.includes('maximum distance')) {
          setSearchError('Jarak terlalu jauh (batas 100km). Pilih lokasi lebih dekat.');
        } else {
          setSearchError(err.error || 'Gagal menghitung rute');
        }
        return;
      }
      const data = await res.json();
      if (!data.routes?.length) { setSearchError('Rute tidak ditemukan'); return; }

      const route = data.routes[0];
      const steps = route.legs?.[0]?.steps || [];
      const maneuverCoords: [number, number][] = steps.map((s: any) => {
        const loc = s.maneuver?.location ?? s.location ?? s.intersections?.[0]?.location ?? null;
        return (loc ? [loc[0], loc[1]] : origin) as [number, number];
      });
      const mappedManeuvers: Maneuver[] = steps.map((s: any) => ({
        instruction: s.maneuver?.instruction ?? 'Lanjutkan', distance: s.distance ?? 0,
        duration: s.duration ?? 0, type: s.maneuver?.type ?? 'unknown',
        modifier: s.maneuver?.modifier, way_name: s.name ?? '',
      }));
      const allRoutes = data.routes.map((r: any) => ({
        geometry: r.geometry, duration: r.duration, distance: r.distance,
        distance_km: r.distance_km, eta_text: r.eta_text,
        safetyScore: r.safetyScore ?? 100,
        safetyLabel: data.safetySummary?.label ?? 'Sangat Aman',
      }));

      setRouteState({
        isNavigating: false, origin, destination: dest,
        routeGeometry: route.geometry, maneuvers: mappedManeuvers,
        currentStepIndex: 0, eta: Math.round(route.duration / 60),
        distance: Math.round(route.distance), steps: steps.length,
        safetyScore: route.safetyScore ?? 100,
        safetyLabel: data.safetySummary?.label ?? 'Sangat Aman',
        hazardWarnings: route.hazardWarnings ?? [], maneuverCoords, allRoutes, selectedRouteIndex: 0,
      });
      if (allRoutes.length > 1) setShowAltRoutes(true);
    } catch (error: any) {
      console.error('Calculate route error:', error);
      setSearchError(error.message || 'Gagal menghitung rute');
    }
  }

  // ─── Select alternative route ───
  function selectAltRoute(index: number) {
    const alt = routeState.allRoutes[index];
    if (!alt) return;
    const steps = alt.geometry.coordinates;
    const newManeuvers = routeState.maneuvers; // keep same maneuvers
    setRouteState(prev => ({
      ...prev,
      routeGeometry: alt.geometry,
      selectedRouteIndex: index,
      eta: Math.round(alt.duration / 60),
      distance: Math.round(alt.distance),
      safetyScore: alt.safetyScore,
      safetyLabel: alt.safetyLabel,
    }));
    setShowAltRoutes(false);
    const map = mapInstance.current;
    if (map) {
      const coords = alt.geometry.coordinates as [number, number][];
      if (coords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const c of coords) bounds.extend([c[0], c[1]] as [number, number]);
        const userLngLat = routeState.origin ?? currentLocation;
        const secondCoord = coords[1] ?? coords[0];
        const targetBearing = getBearing(userLngLat, secondCoord);
        map.fitBounds(bounds, { padding: { top: 100, bottom: 280, left: 60, right: 60 }, pitch: 40, bearing: targetBearing, duration: 1500 });
      }
    }
  }

  // ─── Locate me ───
  function locateMyPosition() {
    if (!navigator.geolocation) { setSearchError('Geolocation tidak didukung browser ini'); return; }
    setIsLocating(true); setSearchError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude, lat = pos.coords.latitude;
        const inID = lng >= 95 && lng <= 141 && lat >= -11 && lat <= 6;
        if (!inID) { setCurrentLocation(DEFAULT_CENTER); setLng(DEFAULT_CENTER[0]); setLat(DEFAULT_CENTER[1]); setSearchError('Lokasi di luar Indonesia — menggunakan Karawang'); }
        else { setCurrentLocation([lng, lat]); setLng(lng); setLat(lat); }
        setLocationPermission('granted');
        if (mapInstance.current) mapInstance.current.flyTo({ center: inID ? [lng, lat] : DEFAULT_CENTER, zoom: 15, duration: 1200 });
        userLocationMarker.current?.setLngLat(inID ? [lng, lat] : DEFAULT_CENTER);
        setIsLocating(false);
      },
      () => {
        setCurrentLocation(DEFAULT_CENTER); setLng(DEFAULT_CENTER[0]); setLat(DEFAULT_CENTER[1]);
        setLocationPermission('denied');
        if (mapInstance.current) mapInstance.current.flyTo({ center: DEFAULT_CENTER, zoom: 14, duration: 1000 });
        userLocationMarker.current?.setLngLat(DEFAULT_CENTER);
        setIsLocating(false);
      },
      { timeout: 20000, enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  // ─── Derived ───
  const currentManeuver = routeState.maneuvers[routeState.currentStepIndex];
  const nextManeuver = routeState.maneuvers[routeState.currentStepIndex + 1];
  const currentInstruction = currentManeuver ? translateManeuver(currentManeuver.instruction, currentManeuver.modifier, currentManeuver.way_name, currentManeuver.distance) : '';
  const maneuverDistance = currentManeuver ? formatDistance(currentManeuver.distance) : '';
  const currentRoad = currentManeuver?.way_name || '';
  const nextInstruction = nextManeuver ? translateManeuver(nextManeuver.instruction, nextManeuver.modifier, nextManeuver.way_name, nextManeuver.distance) : 'Anda telah tiba di tujuan';
  const maneuverIcon = currentManeuver ? MANEUVER_ICONS[currentManeuver.type?.toLowerCase()] || '➡️' : '🏁';

  // ─── Render ───
  return (
    <div className="relative w-full h-full bg-zinc-950 overflow-hidden">

      {/* Full-screen map */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      <style>{`
        .mapboxgl-canvas { width:100% !important; height:100% !important; display:block; }
        .mapboxgl-map { width:100% !important; height:100% !important; }
        .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-attrib { display:none !important; }
        @keyframes offRoutePulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>

      {/* Coordinate indicator */}
      {hasToken && !mapError && !routeState.isNavigating && (
        <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur border border-zinc-200 px-2 py-1 rounded-xl text-xs text-zinc-500 z-10 shadow-sm flex items-center gap-2">
          <span>{lat.toFixed(4)}, {lng.toFixed(4)}</span>
          <span className="text-zinc-400">z{zoom.toFixed(1)}</span>
        </div>
      )}

      {/* Locate me FAB */}
      {hasToken && !isLoading && !routeState.isNavigating && (
        <button onClick={locateMyPosition} disabled={isLocating}
          className={cn("absolute bottom-4 left-4 z-10 w-11 h-11 bg-white/90 backdrop-blur border border-zinc-200 rounded-2xl shadow-lg flex items-center justify-center transition-all hover:bg-white hover:scale-105 active:scale-95",
            isLocating ? "text-brand-orange" : "text-zinc-600 hover:text-brand-orange")} title="Deteksi lokasi saya">
          {isLocating ? <div className="w-4 h-4 border-2 border-brand-orange/30 border-t-brand-orange rounded-full animate-spin" /> : <Locate className="w-5 h-5" />}
        </button>
      )}

      {/* Traffic toggle FAB */}
      {hasToken && !isLoading && !routeState.isNavigating && (
        <button onClick={toggleTraffic}
          className={cn("absolute bottom-20 left-4 z-10 w-11 h-11 bg-white/90 backdrop-blur border rounded-2xl shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95",
            showTraffic ? "border-brand-orange text-brand-orange" : "border-zinc-200 text-zinc-600")} title="Toggle lalu lintas">
          <Layers className="w-5 h-5" />
        </button>
      )}

      {/* Alerts toggle FAB */}
      {hasToken && !isLoading && !routeState.isNavigating && (
        <button onClick={() => setShowAlerts(v => !v)}
          className={cn("absolute bottom-32 left-4 z-10 w-11 h-11 bg-white/90 backdrop-blur border rounded-2xl shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95",
            showAlerts ? "border-brand-orange text-brand-orange" : "border-zinc-200 text-zinc-600")} title="Toggle peringatan jalan">
          <MapPin className="w-5 h-5" />
        </button>
      )}

      {/* Bookmark FAB */}
      {hasToken && !isLoading && !routeState.isNavigating && (
        <button onClick={async () => {
          if (!auth?.currentUser) return;
          const name = routeState.destination?.text || searchQuery || 'Lokasi Tersimpan';
          const address = routeState.destination?.full_address || routeState.destination?.place_name || searchQuery;
          const coords = routeState.destination?.center || currentLocation;
          const { doc, updateDoc, arrayUnion, serverTimestamp } = await import('firebase/firestore');
          try {
            const userRef = doc(db, 'users', auth.currentUser.uid);
            await updateDoc(userRef, {
              favorites: arrayUnion({ id: Date.now().toString(), name, address, coordinates: { lat: coords[1], lng: coords[0] } }),
              updatedAt: serverTimestamp(),
            });
          } catch {}
        }}
          className={cn("absolute bottom-[7.5rem] left-4 z-10 w-11 h-11 bg-white/90 backdrop-blur border rounded-2xl shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95",
            routeState.destination ? "border-brand-orange text-brand-orange" : "border-zinc-200 text-zinc-300 pointer-events-none opacity-50")} title="Simpan lokasi">
          <Bookmark className="w-5 h-5" />
        </button>
      )}

      {/* ─── SEARCH BAR ─── */}
      {!routeState.isNavigating && hasToken && !isLoading && (
        <div className="absolute top-4 left-4 right-4 z-20">

          {/* Search input */}
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-lg border border-zinc-200/80">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <Search className="text-zinc-400 w-4 h-4 shrink-0" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari lokasi..." className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-zinc-900 placeholder-zinc-400"
                onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); setSuggestions([]); } }} />
              {searchLoading && <div className="w-4 h-4 border-2 border-zinc-200 border-t-brand-orange rounded-full animate-spin shrink-0" />}
              {(searchQuery || suggestions.length > 0) && (
                <button onClick={() => { setSearchQuery(''); setSuggestions([]); }} className="text-zinc-400 hover:text-zinc-700 transition-colors"><X className="w-4 h-4" /></button>
              )}
            </div>

            {/* Suggestions */}
            <AnimatePresence>
              {suggestions.length > 0 && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="border-t border-zinc-200 overflow-hidden max-h-52 overflow-y-auto">
                  {suggestions.slice(0, 6).map(s => (
                    <button key={s.id} onClick={() => calculateRoute(s)}
                      className="w-full px-3 py-2.5 flex items-start gap-2 hover:bg-zinc-50 transition-colors text-left border-t border-zinc-100">
                      <MapPin className="w-3.5 h-3.5 text-brand-orange mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-900 leading-tight">{s.text}</p>
                        <p className="text-[10px] text-zinc-500 leading-tight line-clamp-1">{s.full_address || s.place_name?.replace(s.text + ', ', '') || ''}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error message */}
            {searchError && (
              <div className="border-t border-zinc-200 px-3 py-2">
                <p className="text-xs text-red-500">{searchError}</p>
              </div>
            )}

            {/* Route preview */}
            {routeState.routeGeometry && !routeState.isNavigating && (
              <div className="border-t border-zinc-200 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-3.5 h-3.5 text-brand-orange shrink-0" />
                  <p className="text-xs font-medium text-zinc-900 flex-1 truncate">{routeState.destination?.text || 'Tujuan'}</p>
                  <span className="text-xs font-black text-brand-orange shrink-0">~{routeState.eta} menit</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-500 mb-2">
                  <span>{formatDistance(routeState.distance)}</span>
                  <span className="w-px h-3 bg-zinc-200" />
                  <span>Safety {routeState.safetyScore}</span>
                  <span className="w-px h-3 bg-zinc-200" />
                  <span>{routeState.steps} langkah</span>
                </div>

                {/* Alt routes */}
                <AnimatePresence>
                  {showAltRoutes && routeState.allRoutes.length > 1 && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="mb-2 space-y-1.5 overflow-hidden">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Pilih Rute Alternatif</p>
                      {routeState.allRoutes.map((r, i) => (
                        <button key={i} onClick={() => selectAltRoute(i)}
                          className={cn("w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left border transition-all",
                            i === routeState.selectedRouteIndex ? "border-brand-orange bg-brand-orange/5" : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100")}>
                          <div className={cn("w-2 h-2 rounded-full shrink-0", i === routeState.selectedRouteIndex ? "bg-brand-orange" : "bg-zinc-300")} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-zinc-700">{r.eta_text}</span>
                              <span className="text-[10px] text-zinc-400">{r.distance_km}</span>
                            </div>
                            <span className={cn("text-[9px]", i === routeState.selectedRouteIndex ? "text-brand-orange" : "text-zinc-400")}>
                              {r.safetyScore >= 80 ? '🟢' : r.safetyScore >= 60 ? '🟡' : '🔴'} {r.safetyLabel}
                            </span>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex gap-2">
                  <button onClick={resetRoute}
                    className="flex-1 py-2 rounded-xl font-bold text-[10px] text-zinc-600 bg-zinc-100 border border-zinc-200 flex items-center justify-center gap-1 hover:bg-zinc-200 transition-colors">
                    <RotateCcw className="w-3 h-3" /> Batal
                  </button>
                  <button onClick={startNavigation}
                    className="flex-[2] py-2 rounded-xl font-bold text-[10px] bg-brand-orange text-zinc-900 shadow-md flex items-center justify-center gap-1 hover:bg-brand-orange/90 transition-colors active:scale-95">
                    <NavIcon className="w-3 h-3 rotate-45" /> Mulai Navigasi
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── LOADING ─── */}
      <AnimatePresence>
        {isLoading && (
          <motion.div initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-white overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-orange/5 via-transparent to-red-500/5" />
            {[0,1,2].map(i => (
              <motion.div key={i} className="absolute w-96 h-96 bg-brand-orange/10 rounded-full blur-[100px]"
                animate={{ x: [Math.random()*200-100, Math.random()*200-100], y: [Math.random()*200-100, Math.random()*200-100] }}
                transition={{ duration: 4+i, repeat: Infinity, repeatType: "reverse" }}
                style={{ left: `${30+i*20}%`, top: `${20+i*30}%` }} />
            ))}
            <motion.div className="text-center z-10">
              <motion.div animate={{ scale: [0.9, 1.1, 0.9] }} transition={{ duration: 2, repeat: Infinity }}>
                <img src="/Logo Avenly - Color.png" alt="Avenly" className="h-24 w-auto mx-auto mb-6" />
              </motion.div>
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-zinc-600 text-sm font-bold uppercase tracking-widest">Memuat Maps...</motion.p>
              <div className="flex justify-center gap-2 mt-4">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-2 h-2 bg-brand-orange rounded-full"
                    animate={{ scale: [0, 1, 0], opacity: [0, 1, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i*0.2 }} />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── TOKEN ERROR ─── */}
      {!isLoading && tokenError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-8 text-center bg-white/95 backdrop-blur-md rounded-3xl">
          <div className="max-w-sm space-y-4">
            <div className="w-16 h-16 bg-red-500/20 rounded-3xl flex items-center justify-center mx-auto border border-red-500/30">
              <MapPin className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-zinc-900 mb-2">Mapbox Token Bermasalah</h2>
            <p className="text-sm text-zinc-500 leading-relaxed">{tokenError}</p>
            <button onClick={() => window.open('https://account.mapbox.com/access-tokens/', '_blank')}
              className="w-full bg-brand-orange text-zinc-900 py-3 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-brand-orange/90 transition-colors">
              Dapatkan Public Token
            </button>
          </div>
        </div>
      )}

      {/* ─── ACTIVE NAVIGATION OVERLAY ─── */}
      <AnimatePresence>
        {routeState.isNavigating && routeState.routeGeometry && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col pointer-events-none">

            {/* Off-route banner */}
            <AnimatePresence>
              {isOffRoute && (
                <motion.div ref={offRouteBannerRef} initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
                  className="bg-amber-500/95 backdrop-blur border-b border-amber-400 px-4 py-3 flex items-center gap-3 pointer-events-auto">
                  <span className="text-xl">⚠️</span>
                  <p className="text-sm font-black text-amber-950 flex-1">
                    {isReRouting ? '⏳ Mencari rute ulang...' : '🚗 Anda keluar dari rute! Rute ulang...'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compact top info bar */}
            <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, type: "spring" }}
              className="px-4 pt-6 pb-2 pointer-events-auto">
              <div className="flex items-center justify-between gap-3">
                {/* Direction compass */}
                <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-2xl px-3 py-2 shadow-lg border border-white/50">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-orange/20 to-red-500/20 flex items-center justify-center">
                    <div className="transition-transform duration-300 ease-out" style={{ transform: `rotate(${-userHeading}deg)` }}>
                      <svg viewBox="0 0 40 40" className="w-6 h-6">
                        <polygon points="20,4 17,16 20,13 23,16" className="fill-red-500" />
                        <polygon points="20,36 17,24 20,27 23,24" className="fill-zinc-300" />
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Arah</p>
                    <p className="text-sm font-black text-black leading-tight">{getDirectionName(userHeading)}</p>
                  </div>
                </div>

                {/* ETA */}
                <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-2xl px-3 py-2 shadow-lg border border-white/50">
                  <div className="w-9 h-9 rounded-xl bg-brand-orange/20 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-brand-orange" />
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Sisa</p>
                    <p className="text-sm font-black text-brand-orange leading-tight">{routeState.eta} <span className="text-[10px] text-zinc-500 font-bold">mnt</span></p>
                  </div>
                </div>

                {/* Distance */}
                <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-2xl px-3 py-2 shadow-lg border border-white/50">
                  <div className="w-9 h-9 rounded-xl bg-brand-orange/20 flex items-center justify-center">
                    <Navigation2 className="w-4 h-4 text-brand-orange" />
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Jarak</p>
                    <p className="text-sm font-black text-black leading-tight">{routeState.distance >= 1000 ? `${(routeState.distance/1000).toFixed(1)} km` : `${routeState.distance} m`}</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Main instruction strip */}
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
              className="px-4 mb-1 pointer-events-auto">
              <div className="bg-white/90 backdrop-blur rounded-2xl p-3 shadow-lg border border-white/50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-orange to-red-500 flex items-center justify-center shadow-md shrink-0">
                  <span className="text-lg">{maneuverIcon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-brand-orange uppercase tracking-widest mb-0.5">{maneuverDistance} • {currentRoad || 'Jl. ...'}</p>
                  <p className="text-base font-black text-black leading-tight truncate">{currentInstruction || 'Mulai perjalanan'}</p>
                </div>
                <div className="shrink-0">
                  <div className="w-10 h-10 rounded-full border-2 border-zinc-100 flex items-center justify-center relative">
                    <svg className="w-full h-full -rotate-90">
                      <circle cx="20" cy="20" r="17" fill="none" stroke="#f5f5f5" strokeWidth="3" />
                      <circle cx="20" cy="20" r="17" fill="none" stroke="#f97316" strokeWidth="3"
                        strokeDasharray={`${(routeProgress * 106.8)} 106.8`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute text-[9px] font-black text-zinc-600">{Math.round(routeProgress * 100)}%</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Floating Recenter Button */}
            <button onClick={() => setIsRecenterNeeded(true)}
              className="absolute top-24 right-4 bg-brand-orange text-white w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center pointer-events-auto active:scale-95 transition-all z-30"
              title="Pusatkan ke lokasi saya">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" fill="white" stroke="none"/>
                <circle cx="12" cy="12" r="8"/>
                <line x1="12" y1="2" x2="12" y2="6"/>
                <line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="6" y2="12"/>
                <line x1="18" y1="12" x2="22" y2="12"/>
              </svg>
            </button>

            {/* Route progress dots */}
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
              className="px-4 mb-1 pointer-events-auto">
              <div className="flex gap-1">
                {routeState.maneuvers.slice(0, 10).map((_, i) => (
                  <motion.div key={i} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.05 }}
                    className={cn("h-1 flex-1 rounded-full transition-all origin-left",
                      i <= routeState.currentStepIndex ? "bg-gradient-to-r from-brand-orange to-red-500" : "bg-white/20")} />
                ))}
                {routeState.maneuvers.length > 10 && (
                  <span className="text-[10px] text-white/60 self-center ml-2 font-bold">+{routeState.maneuvers.length - 10}</span>
                )}
              </div>
            </motion.div>

            <div className="flex-1 pointer-events-none" />

            {/* Next step */}
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5, type: "spring" }}
              className="px-4 mb-2 pointer-events-auto">
              <div className="bg-white/95 backdrop-blur border border-zinc-100 rounded-2xl p-3 shadow-lg flex items-center gap-3">
                <div className="w-6 h-6 rounded-lg bg-brand-orange/10 flex items-center justify-center">
                  <ChevronRight className="w-3 h-3 text-brand-orange" />
                </div>
                <p className="text-xs text-zinc-500">Next: <span className="text-zinc-900 font-bold">{nextInstruction}</span></p>
              </div>
            </motion.div>

            {/* Bottom controls — compact */}
            <motion.div initial={{ y: 80 }} animate={{ y: 0 }} transition={{ delay: 0.6, type: "spring" }}
              className="px-4 pb-4 pointer-events-auto space-y-2">

              {/* Traffic + North lock row */}
              <div className="flex gap-2">
                <button onClick={toggleTraffic}
                  className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-all shrink-0",
                    showTraffic ? "bg-brand-orange border-brand-orange text-white shadow-lg" : "bg-white/90 border-zinc-200 text-zinc-600 hover:bg-white")}>
                  <Layers className="w-4 h-4" />
                </button>
                <button onClick={() => setIsNorthLocked(v => !v)}
                  className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-all shrink-0",
                    isNorthLocked ? "bg-brand-orange border-brand-orange text-white shadow-lg" : "bg-white/90 border-zinc-200 text-zinc-600 hover:bg-white")}>
                  <Navigation2 className="w-4 h-4" />
                </button>
                {/* Arrive demo */}
                <button onClick={() => { setShowArrival(true); setArrivalDestination(routeState.destination?.full_address || routeState.destination?.place_name || 'Tujuan'); }}
                  className="flex-1 bg-green-500/90 hover:bg-green-500 text-white py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md">
                  🎯 Tiba di Tujuan
                </button>
                {/* End navigation */}
                <button onClick={cancelNavigation}
                  className="bg-red-500/90 hover:bg-red-500 text-white py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all shadow-md active:scale-95">
                  <X className="w-4 h-4" />Stop
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── ARRIVAL MODAL ─── */}
      <AnimatePresence>
        {showArrival && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowArrival(false)}>
            <motion.div initial={{ scale: 0.5, y: 100, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.5, y: 100, opacity: 0 }} transition={{ type: "spring", stiffness: 100, damping: 15 }}
              className="bg-white rounded-3xl p-8 mx-6 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="relative">
                <motion.div className="absolute -inset-4 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full opacity-20"
                  animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.3, 0.2] }} transition={{ duration: 2, repeat: Infinity }} />
                <motion.div className="absolute -inset-8 bg-gradient-to-br from-brand-orange to-red-500 rounded-full opacity-10"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }} transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }} />
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3, type: "spring" }}
                  className="relative w-24 h-24 mx-auto mb-6">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full shadow-xl shadow-green-500/50" />
                  <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full p-6">
                    <path d="M5 12l5 5L20 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray="24" strokeDashoffset="0" />
                  </svg>
                </motion.div>
              </div>
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="text-center mb-6">
                <h2 className="text-2xl font-black text-zinc-900 mb-2">Anda Telah Tiba!</h2>
                <p className="text-sm text-zinc-500 font-medium">{arrivalDestination}</p>
              </motion.div>
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}
                className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <p className="text-xl font-black text-brand-orange">{routeState.distance >= 1000 ? `${(routeState.distance/1000).toFixed(1)}km` : `${routeState.distance}m`}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Jarak</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-brand-orange">{routeState.eta}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Menit</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black text-brand-orange">{routeState.safetyScore}%</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Safety</p>
                </div>
              </motion.div>
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }}
                className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 mb-6 border border-green-100">
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
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.7 }} className="space-y-3">
                <button onClick={() => { setShowArrival(false); cancelNavigation(); resetRoute(); }}
                  className="w-full bg-gradient-to-r from-brand-orange to-red-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-brand-orange/40 active:scale-95 transition-all">
                  Rute Baru
                </button>
                <button onClick={() => setShowArrival(false)}
                  className="w-full bg-zinc-100 text-zinc-600 py-3 rounded-xl font-bold text-xs uppercase tracking-wider active:scale-95 transition-all">
                  Tutup
                </button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
