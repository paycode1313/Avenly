# MapVision PWA — Implementation Summary

## Project Overview
MapVision is a React-based Progressive Web App for road hazard reporting and turn-by-turn navigation with social features. Built with Vite, React 19, TypeScript, Firebase, Mapbox GL, and Google Gemini AI.

## How to Run

```bash
npm install
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm start            # Run production build
```

## Environment Setup

Copy `.env.example` to `.env` and set:
```env
VITE_MAPBOX_ACCESS_TOKEN=pk.eyJ1...   # Required — must start with "pk."
MAPBOX_ACCESS_TOKEN=pk.eyJ1...        # Server-side geocoding/directions
GEMINI_API_KEY=...                    # Required — for AI road analysis
```

**Important:** Use a **Public Token** (starts with `pk.`), not a Secret Key (`sk.`).

## Key Features

### 1. Turn-by-Turn Navigation (MapboxView, NavigateView)
- Search any real location in Indonesia via Mapbox Geocoding API
- Route calculation with safety scoring
- Proximity-based turn-by-turn: auto-advances when within 50m of maneuver point
- Voice announcements in Indonesian (SpeechSynthesis API)

### 2. AI Road Scanning (NavigateView)
- Camera-based hazard detection via Gemini AI
- Scans every 5 seconds while navigating
- Hazard alerts with voice warnings
- Only active when "AI Scan" is enabled during navigation

### 3. Social Feed (SocialFeed.tsx)
- Instagram-style travel posts
- Firebase Auth for user login
- Mock posts with location-based content

### 4. User Profile (ProfileView.tsx)
- Firebase Auth integration
- Favorites management
- Auth UI component

## API Endpoints

All endpoints are served at `http://localhost:3000/api/` (or your production URL).

### `GET /api/health`
Health check. Returns `{ status: "ok" }`.

### `GET /api/geocode?query=<string>&proximity=<lng,lat>`
Search for locations using Mapbox Geocoding API + custom locations fallback.

**Response:**
```json
{
  "features": [
    { "id": "...", "text": "...", "place_name": "...", "center": [lng, lat], "properties": { "custom": true } }
  ]
}
```

**Custom Locations (built-in):**
- Kota Karawang [107.3371, -6.3065]
- Alun-Alun Karawang [107.338, -6.31]
- Pasar Karyagem [107.336, -6.308]
- Tugu VW [107.345, -6.295]
- Gerbang Tol Karawang [107.385, -6.285]
- RSUD Karawang [107.335, -6.295]

### `POST /api/directions`
Calculate driving route between two points.

**Request:**
```json
{ "origin": [lng, lat], "destination": [lng, lat] }
```

**Response:**
```json
{
  "routes": [{ "geometry": {...}, "duration": secs, "distance": meters, "safetyScore": 0-100, "hazardWarnings": [...] }],
  "safetySummary": { "label": "Sangat Aman", "warnings": [...] }
}
```

**Note:** Max 100km distance (Mapbox free tier). For longer distances, choose closer destinations.

### `POST /api/analyze-road`
AI-powered road hazard analysis from camera image.

**Request:**
```json
{ "image": "base64_jpeg...", "location": { "lat": 0, "lng": 0 } }
```

**Response:**
```json
{ "hazardDetected": true, "type": "pothole", "severity": "high", "description": "..." }
```

### `GET /api/locations`
List all custom locations.

### `POST /api/locations`
Add a new custom location.

## Architecture

### File Structure
```
src/
  components/
    Layout.tsx          # Main layout with bottom nav
    MapboxView.tsx      # Map page with search + route preview
    NavigateView.tsx    # AI navigation mode with camera
    SocialFeed.tsx      # Instagram-style social feed
    ProfileView.tsx     # User profile + Firebase auth
    Auth.tsx            # Firebase auth modal
  lib/
    firebase.ts         # Firebase config + error handler
    utils.ts            # Utility functions (cn)
  types.ts              # TypeScript interfaces
  App.tsx               # React Router setup
  main.tsx              # Entry point
server.ts               # Express + Vite dev server with all API routes
```

### Firebase Collections
- `/users/{userId}` — User profile
- `/alerts/{alertId}` — Road hazard reports
- `/posts/{postId}` — Social feed posts

### Security Rules
See `firestore.rules` for Firestore security rules. Rules enforce:
- Identity verification (reporterId must match request.auth.uid)
- Timestamp immutability
- Field size limits

## Bugs Fixed (v2.0)

### 1. Spinner Reset Bug (Debounce)
**Problem:** `currentLocation` in useEffect deps caused `searchPlaces` to be recreated on every GPS update (~1/sec), which reset the debounce timer before searches could complete.

**Fix:** Use `currentLocationRef` — read latest location at call time without causing function recreation.

```tsx
const currentLocationRef = useRef(currentLocation);
useEffect(() => { currentLocationRef.current = currentLocation; }, [currentLocation]);
// In searchPlaces:
const locationAtCall = currentLocationRef.current;
```

### 2. Black Screen on Route Selection
**Problem:** Clicking a suggestion triggered `setSearchQuery` → React re-render → debounce useEffect fired → `searchPlaces` ran again → `setSearchLoading(true)` → `setSuggestions([])` → dropdown disappeared → user saw blank while route was calculating.

**Fix:** Use `isCalculatingRouteRef` to skip re-search when `calculateRoute` updates `searchQuery`.

```tsx
// In calculateRoute:
isCalculatingRouteRef.current = true;
setSearchQuery(dest.place_name);

// In useEffect:
if (isCalculatingRouteRef.current) {
  isCalculatingRouteRef.current = false;
  return; // Skip re-search, keep suggestions visible
}
```

### 3. Geocode Error Handling
**Problem:** If Mapbox API failed, no results shown at all.

**Fix:** Custom locations serve as fallback. If Mapbox fails but custom locations match, return those. Error returns both `error` and `features` so frontend can still display results.

### 4. Input onChange Cleared Suggestions
**Problem:** `onChange={e => { setSearchQuery(e.target.value); setSuggestions([]); }}` cleared dropdown on every keystroke.

**Fix:** Remove `setSuggestions([])` from `onChange`. Debounce handles typing, Escape key clears manually.

## Routes in App

| Path | Component | Description |
|------|-----------|-------------|
| `/` | MapboxView | Main map with search + route preview |
| `/navigate` | NavigateView | AI navigation with camera |
| `/social` | SocialFeed | Instagram-style feed |
| `/profile` | ProfileView | User profile + auth |

## Navigation Flow

1. User searches for location → Mapbox Geocoding API returns suggestions
2. User clicks suggestion → `calculateRoute` called → route preview shows
3. User clicks "Mulai Navigasi" → `isNavigating: true` → full-screen nav UI
4. Proximity-based turn-by-turn: when within 50m of next maneuver, auto-advance + voice
5. AI Scan (optional): dashboard camera scans for hazards every 5 seconds

## Troubleshooting

### "Tidak ada hasil ditemukan"
- Check browser console for API errors
- Verify `VITE_MAPBOX_ACCESS_TOKEN` in `.env` is valid and starts with `pk.`
- Try searching "karawang" or "jakarta" — custom + Mapbox results should appear

### Black screen after clicking location
- This was caused by `setSuggestions([])` in the input onChange handler
- Fixed by removing it and using `isCalculatingRouteRef` pattern
- Update to latest version

### Token error in UI
- Ensure `.env` has `VITE_MAPBOX_ACCESS_TOKEN=pk.eyJ1...`
- Must be a **Public Token** (starts with `pk.`), not Secret Key (`sk.`)
- Get tokens at https://account.mapbox.com/access-tokens/

### Route not appearing after clicking suggestion
- Check terminal for `Route found:` log
- Verify `MAPBOX_ACCESS_TOKEN` (server-side) is also set in `.env`
- Check for CORS errors in browser dev tools

### Location outside Indonesia
- NavigateView defaults to Karawang [-6.3065, 107.3371] if location is outside Indonesia bounds
- To disable this check, remove the `isInIndonesia` validation in `fetchLocation`