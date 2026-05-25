import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

// ESM equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Default center: Karawang, West Java
const DEFAULT_CENTER: [number, number] = [107.3371, -6.3065];

// In-memory custom locations store (replace with Firebase in production)
interface CustomLocation {
  id: string;
  name: string;
  place_name: string;
  center: [number, number];
  addedBy: string;
  createdAt: string;
}

const customLocations: CustomLocation[] = [
  {
    id: 'karawang-center-1',
    name: 'Kota Karawang',
    place_name: 'Kota Karawang, Jawa Barat, Indonesia',
    center: [107.3371, -6.3065],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'alun-alun-karawang-1',
    name: 'Alun-Alun Karawang',
    place_name: 'Alun-Alun Karawang, Jawa Barat, Indonesia',
    center: [107.3380, -6.3100],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'rsud-karawang-1',
    name: 'RSUD Karawang',
    place_name: 'Rumah Sakit Umum Daerah Karawang, Jawa Barat',
    center: [107.3350, -6.2950],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'tol-karawang-1',
    name: 'Gerbang Tol Karawang',
    place_name: 'Gerbang Tol Karawang, Jawa Barat, Indonesia',
    center: [107.3850, -6.2850],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'pasar-karawang-1',
    name: 'Pasar Karyagem',
    place_name: 'Pasar Karyagem, Karawang, Jawa Barat',
    center: [107.3360, -6.3080],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'tugu-vw-1',
    name: 'Tugu VW',
    place_name: 'Tugu VW, Karawang, Jawa Barat, Indonesia',
    center: [107.3450, -6.2950],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Road analysis endpoint
  app.post("/api/analyze-road", async (req, res) => {
    try {
      const { image, location } = req.body;
      if (!image) return res.status(400).json({ error: "No image provided" });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            parts: [
              { text: "Analyze this image from a vehicle's dashboard. Identify if there are any road hazards such as potholes (lubang), floods (banjir), accidents, or major obstacles. Respond in JSON format with: { hazardDetected: boolean, type: string | null, severity: 'low' | 'medium' | 'high' | null, description: string | null }" },
              { inlineData: { mimeType: "image/jpeg", data: image } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const analysis = JSON.parse(response.text || "{}");
      res.json({ ...analysis, location });
    } catch (error: any) {
      console.error("AI Analysis error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Weather proxy or simulation
  app.get("/api/weather", async (req, res) => {
    const { lat, lon } = req.query;
    res.json({
      temp: 28,
      condition: "Cerah Berawan",
      warning: null
    });
  });

  // Custom Locations - List all
  app.get("/api/locations", (req, res) => {
    res.json({ features: customLocations.map(loc => ({
      id: loc.id,
      text: loc.name,
      place_name: loc.place_name,
      center: loc.center,
      properties: { custom: true }
    }))});
  });

  // Custom Locations - Add new
  app.post("/api/locations", (req, res) => {
    const { name, place_name, center, addedBy } = req.body;
    if (!name || !place_name || !center) {
      return res.status(400).json({ error: "name, place_name, center required" });
    }
    const newLoc: CustomLocation = {
      id: `custom-${Date.now()}`,
      name,
      place_name,
      center,
      addedBy: addedBy || 'anonymous',
      createdAt: new Date().toISOString()
    };
    customLocations.push(newLoc);
    res.status(201).json(newLoc);
  });

  // ========== MAPBOX API (FREE TIER) ==========

  // Mapbox Geocoding - search for places
  app.get("/api/geocode", async (req, res) => {
    try {
      const { query, proximity } = req.query;
      if (!query) return res.status(400).json({ error: "Query required" });

      console.log(`🔍 Geocode request: "${query}" (proximity: ${proximity})`);

      // Support both env variable names for flexibility
      const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
      if (!mapboxToken) {
        console.error("❌ Mapbox token not found. Set MAPBOX_ACCESS_TOKEN in .env");
        return res.status(500).json({ error: "Mapbox token not configured" });
      }

      // Search custom locations first
      const q = (query as string).toLowerCase();
      const customResults = customLocations
        .filter(loc => loc.name.toLowerCase().includes(q) || loc.place_name.toLowerCase().includes(q))
        .map(loc => ({
          id: loc.id,
          text: loc.name,
          place_name: loc.place_name,
          center: loc.center,
          properties: { custom: true }
        }));

      console.log(`📍 Found ${customResults.length} custom locations`);

      // Use proximity from request if provided, otherwise use default
      const proximityCoords = proximity || `${DEFAULT_CENTER[0]},${DEFAULT_CENTER[1]}`;

      // Mapbox Geocoding API - Indonesia region with broader types
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query as string)}.json?access_token=${mapboxToken}&country=id&language=id&types=poi,address,place,locality,neighborhood&proximity=${proximityCoords}&limit=10`;

      console.log(`🌐 Calling Mapbox Geocoding API...`);
      const response = await fetch(geocodeUrl);
      const data = await response.json();

      console.log(`📦 Mapbox response status: ${response.status}`);

      if (data.message === 'Not Authorized - Invalid Token') {
        console.error("❌ Mapbox Geocoding error: Invalid token");
        // Return custom results if available
        if (customResults.length > 0) {
          console.log(`✅ Returning ${customResults.length} custom results as fallback`);
          return res.json({ features: customResults });
        }
        return res.status(500).json({ error: "Mapbox token tidak valid" });
      }

      if (data.message) {
        console.error("❌ Mapbox API error:", data.message);
        // Return custom results if available
        if (customResults.length > 0) {
          console.log(`✅ Returning ${customResults.length} custom results as fallback`);
          return res.json({ features: customResults });
        }
        return res.status(500).json({ error: data.message });
      }

      // Merge custom results with Mapbox results and enrich addresses
      let mapboxFeatures = data.features || [];

      // Enrich Mapbox features with complete address
      mapboxFeatures = mapboxFeatures.map((feature: any) => {
        // Build full address from context
        const context = feature.context || [];
        let fullAddress = feature.place_name;

        // Extract context parts
        const regionContext = context.find((c: any) => c.id.includes('region'))?.text || '';
        const districtContext = context.find((c: any) => c.id.includes('district'))?.text || '';
        const placeContext = context.find((c: any) => c.id.includes('place'))?.text || '';
        const localityContext = context.find((c: any) => c.id.includes('locality'))?.text || '';
        const neighborhoodContext = context.find((c: any) => c.id.includes('neighborhood'))?.text || '';
        const postcodeContext = context.find((c: any) => c.id.includes('postcode'))?.text || '';

        // If place_name is short, build full address
        if (fullAddress.split(',').length < 3) {
          const parts = [
            feature.text,
            neighborhoodContext,
            localityContext || districtContext,
            placeContext,
            regionContext,
            'Indonesia'
          ].filter(Boolean);

          fullAddress = parts.join(', ');
          if (postcodeContext) fullAddress += ` ${postcodeContext}`;
        }

        return {
          ...feature,
          full_address: fullAddress,
          short_address: feature.text,
          district: districtContext,
          city: placeContext || localityContext,
          region: regionContext,
          postcode: postcodeContext,
        };
      });

      const allFeatures = [...customResults, ...mapboxFeatures];

      console.log(`✅ Returning ${allFeatures.length} total results (${customResults.length} custom + ${mapboxFeatures.length} Mapbox)`);

      res.json({ features: allFeatures });
    } catch (error: any) {
      console.error("❌ Geocoding error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Haversine distance in km between two [lng, lat] points
  function haversineKm(a: [number, number], b: [number, number]): number {
    const R = 6371;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  // Score a route based on proximity to hazard hotspots
  function scoreRouteSafety(
    steps: any[],
    hazards: { center: [number, number]; severity: string; name: string }[]
  ): { safetyScore: number; hazardWarnings: { name: string; severity: string; distanceKm: number }[] } {
    const WARNING_RADIUS_KM = 3;
    const warnings: { name: string; severity: string; distanceKm: number }[] = [];

    for (const step of steps) {
      if (!step) continue;
      const stepLoc: [number, number] | null =
        (step as any).location ??
        (step as any).maneuver?.location ??
        (step as any).intersections?.[0]?.location ??
        null;
      if (!stepLoc) continue;

      for (const hazard of hazards) {
        const dist = haversineKm(stepLoc, hazard.center);
        if (dist <= WARNING_RADIUS_KM) {
          warnings.push({ name: hazard.name, severity: hazard.severity, distanceKm: dist });
        }
      }
    }

    let penalty = 0;
    for (const w of warnings) {
      const factor = w.distanceKm < 1 ? 1.5 : w.distanceKm < 2 ? 1 : 0.5;
      penalty += w.severity === 'high' ? 30 * factor : w.severity === 'medium' ? 15 * factor : 5 * factor;
    }
    const safetyScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    return { safetyScore, hazardWarnings: warnings.slice(0, 10) };
  }

  // Mapbox Directions - get route between two points
  app.post("/api/directions", async (req, res) => {
    try {
      const { origin, destination, avoidHazards } = req.body;
      if (!origin || !destination) {
        return res.status(400).json({ error: "Origin and destination required" });
      }

      const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
      if (!mapboxToken) {
        console.error("Mapbox token not found. Set MAPBOX_ACCESS_TOKEN in .env");
        return res.status(500).json({ error: "Mapbox token not configured" });
      }

      // Hazard hotspots for safety scoring (in production, these come from Firestore alerts)
      const hazardHotspots = [
        { center: [107.3380, -6.3100] as [number, number], severity: 'medium', name: 'Alun-Alun Karawang (ramai)' },
        { center: [107.3360, -6.3080] as [number, number], severity: 'low', name: 'Pasar Karyagem (padat)' },
        { center: [107.3350, -6.2950] as [number, number], severity: 'low', name: 'RSUD Karawang (akses ramai)' },
        { center: [107.3450, -6.2950] as [number, number], severity: 'low', name: 'Tugu VW (simpang sibuk)' },
      ];

      const originStr = `${origin[0]},${origin[1]}`;
      const destStr = `${destination[0]},${destination[1]}`;

      // Fetch up to 3 route alternatives for comparison
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originStr};${destStr}?geometries=geojson&overview=full&steps=true&language=id&alternatives=true&access_token=${mapboxToken}`;

      console.log(`Mapbox Directions: ${originStr} -> ${destStr}`);
      const response = await fetch(url);
      const data = await response.json();

      if (data.message) {
        console.error("Mapbox Directions error:", data.message);
        return res.status(500).json({ error: data.message });
      }

      if (!data.routes || data.routes.length === 0) {
        return res.status(500).json({ error: "No routes found" });
      }

      // Score each route for safety and pick the best one
      const scoredRoutes = data.routes.map((route: any) => {
        const steps = route.legs?.[0]?.steps || [];
        const { safetyScore, hazardWarnings } = scoreRouteSafety(steps, hazardHotspots);
        return { ...route, safetyScore, hazardWarnings };
      });

      let selectedRoute: any;
      if (avoidHazards) {
        selectedRoute = scoredRoutes.reduce((best: any, r: any) =>
          r.safetyScore > (best?.safetyScore ?? 0) ? r : best, scoredRoutes[0]);
      } else {
        selectedRoute = scoredRoutes.reduce((best: any, r: any) =>
          r.duration < (best?.duration ?? Infinity) ? r : best, scoredRoutes[0]);
      }

      const allRoutes = scoredRoutes.map((r: any) => ({
        geometry: r.geometry,
        duration: r.duration,
        distance: r.distance,
        distance_km: (r.distance / 1000).toFixed(1),
        eta_text: (() => {
          const mins = Math.round(r.duration / 60);
          return mins >= 60 ? `${Math.floor(mins / 60)} jam ${mins % 60} menit` : `${mins} menit`;
        })(),
        legs: r.legs,
        safetyScore: r.safetyScore,
        hazardWarnings: r.hazardWarnings,
      }));

      const bestRoute = allRoutes[0];

      console.log(`Route found: ${bestRoute.distance_km}km, safety=${bestRoute.safetyScore}/100, ${bestRoute.hazardWarnings.length} warnings`);

      res.json({
        routes: allRoutes,
        selectedRouteIndex: 0,
        safetySummary: {
          score: bestRoute.safetyScore,
          label: bestRoute.safetyScore >= 80 ? 'Sangat Aman'
            : bestRoute.safetyScore >= 60 ? 'Cukup Aman'
            : bestRoute.safetyScore >= 40 ? 'Hati-Hati'
            : 'Rute Berisiko',
          warnings: bestRoute.hazardWarnings.slice(0, 3),
        }
      });
    } catch (error: any) {
      console.error("Directions error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Push Notification Endpoints
  // ============================================

  // Send push notification to a subscription
  app.post("/api/push/send", async (req, res) => {
    try {
      const { subscription, notification } = req.body;

      if (!subscription || !notification) {
        res.status(400).json({ error: "Missing subscription or notification data" });
        return;
      }

      // In production, use web-push library
      // For demo, we'll just log it
      console.log("📱 Push notification sent:", {
        endpoint: subscription.endpoint,
        title: notification.title,
        body: notification.body,
      });

      res.json({ success: true, message: "Push notification sent" });
    } catch (error: any) {
      console.error("Push error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Subscribe to push notifications (store subscription)
  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const { subscription, userId } = req.body;

      if (!subscription) {
        res.status(400).json({ error: "Missing subscription" });
        return;
      }

      // In production, store in Firebase or database
      console.log("✅ Push subscription stored:", {
        endpoint: subscription.endpoint,
        userId: userId || "anonymous",
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Subscribe error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test push notification
  app.get("/api/push/test", (req, res) => {
    console.log("📱 Push test endpoint called");
    res.json({ success: true, message: "Push test OK" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Only use Vite middleware for non-API routes
    app.use((req, res, next) => {
      if (req.url.startsWith('/api/')) {
        return next();
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
