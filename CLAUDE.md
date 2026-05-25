# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MapVision PWA - A React-based progressive web app for road hazard reporting and navigation with social features. Built with Vite, React 19, TypeScript, Firebase, Mapbox GL, and Google Gemini AI for image analysis.

## Development Commands

### Local Development
```bash
npm install              # Install dependencies
npm run dev              # Start dev server with tsx (runs server.ts on port 3000)
npm run build            # Build for production (Vite + esbuild bundle)
npm start                # Run production build
npm run lint             # Type-check with TypeScript (no emit)
npm run clean            # Remove dist folder
```

### Environment Setup
- Copy `.env.example` to `.env.local` (if it exists — project may have `.env` directly)
- Set `GEMINI_API_KEY` for AI image analysis
- Set `VITE_MAPBOX_ACCESS_TOKEN` for maps and navigation (must be a **Public Token** starting with `pk.`, not a Secret Key `sk.`)
- Firebase config is loaded from `firebase-applet-config.json`

## Architecture

### Server (server.ts)
Express server with Vite middleware in development mode. Key endpoints:
- `POST /api/analyze-road` - Gemini AI analysis of dashboard camera images for hazard detection (potholes, floods, accidents)
- `GET /api/weather` - Weather data endpoint (currently simulated)
- `GET /api/health` - Health check

### Frontend Structure
- **App.tsx**: React Router setup with 4 main routes (map, navigate, social, profile)
- **Layout.tsx**: Main layout wrapper with navigation
- **MapboxView.tsx**: Interactive map showing road alerts and user location
- **NavigateView.tsx**: Turn-by-turn navigation interface
- **SocialFeed.tsx**: Instagram-like feed for travel posts
- **ProfileView.tsx**: User profile and favorites management
- **Auth.tsx**: Firebase authentication component

### Firebase Collections
Defined in `firebase-blueprint.json` and enforced by `firestore.rules`:

1. `/users/{userId}` - UserProfile documents (private to owner)
   - uid, displayName, photoURL, email, favorites[]
   
2. `/alerts/{alertId}` - RoadAlert documents (public read, auth create)
   - type (accident|pothole|flood|traffic|other)
   - severity (low|medium|high)
   - coordinates, reporterId, timestamp
   - Max description: 1000 chars
   
3. `/posts/{postId}` - Post documents (public read, auth create)
   - userId, imageUrl, caption, locationName, coordinates
   - likes[] (UIDs), comments[]
   - Max caption: 2200 chars

### Security Rules (firestore.rules)
- Default deny-all with explicit allow rules
- Identity enforcement: `reporterId` and `userId` must match `request.auth.uid`
- Timestamp enforcement: `createdAt` and `timestamp` must equal `request.time`
- Field size li enforced (descriptions, captions, displayName)
- Update restrictions: users can only modify specific fields
- Community features: anyone can add likes to posts/alerts
- See `security_spec.md` for the "Dirty Dozen" attack payloads that rules must reject

### Key Libraries
- **@google/genai**: Gemini AI SDK for image analysis
- **mapbox-gl**: Interactive maps and navigation
- **firebase**: Authentication and Firestore database
- **framer-motion**: UI animations
- **react-router-dom**: Client-side routing
- **tailwindcss v4**: Styling via Vite plugin

## Important Patterns

### Firebase Error Handling
Use `handleFirestoreError()` from `src/lib/firebase.ts` to log structured error info including auth state and operation type.

### Type Safety
All Firebase entities have corresponding TypeScript interfaces in `src/types.ts`. Keep these in sync with `firebase-blueprint.json`.

### HMR Configuration
Vite HMR is disabled when `DISABLE_HMR=true` (AI Studio environment) to prevent flickering during agent edits.

### Path Aliases
`@/*` resolves to project root (configured in tsconfig.json and vite.config.ts).

## Security Considerations

When modifying Firestore rules:
1. Test against all 12 attack payloads in `security_spec.md`
2. Maintain identity enforcement (no spoofing)
3. Preserve timestamp immutability
4. Keep field size limits
5. Ensure default-deny remains at top level
