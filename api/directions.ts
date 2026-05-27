import type { VercelRequest, VercelResponse } from '@vercel/node';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { origin, destination, avoidHazards } = req.body;

    if (!origin || !destination) {
      res.status(400).json({ error: 'Origin and destination required' });
      return;
    }

    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
      res.status(500).json({ error: 'Mapbox token not configured' });
      return;
    }

    // Hazard hotspots for safety scoring (in production, from Firestore alerts)
    const hazardHotspots = [
      { center: [107.3380, -6.3100] as [number, number], severity: 'medium' as const, name: 'Alun-Alun Karawang (ramai)' },
      { center: [107.3360, -6.3080] as [number, number], severity: 'low' as const, name: 'Pasar Karyagem (padat)' },
      { center: [107.3350, -6.2950] as [number, number], severity: 'low' as const, name: 'RSUD Karawang (akses ramai)' },
      { center: [107.3450, -6.2950] as [number, number], severity: 'low' as const, name: 'Tugu VW (simpang sibuk)' },
    ];

    const originStr = `${origin[0]},${origin[1]}`;
    const destStr = `${destination[0]},${destination[1]}`;

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originStr};${destStr}?geometries=geojson&overview=full&steps=true&language=id&alternatives=true&access_token=${mapboxToken}`;

    console.log(`Mapbox Directions: ${originStr} -> ${destStr}`);
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mapbox Directions error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (data.message) {
      console.error('Mapbox Directions error:', data.message);
      res.status(500).json({ error: data.message });
      return;
    }

    if (!data.routes || data.routes.length === 0) {
      res.status(500).json({ error: 'No routes found' });
      return;
    }

    // Score each route for safety
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

    res.status(200).json({
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
    console.error('Directions error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}