import type { VercelRequest, VercelResponse } from '@vercel/node';

const HAZARD_HOTSPOTS = [
  { center: [107.3380, -6.3100] as [number, number], severity: 'medium' as const, name: 'Alun-Alun Karawang (ramai)' },
  { center: [107.3360, -6.3080] as [number, number], severity: 'low' as const, name: 'Pasar Karyagem (padat)' },
  { center: [107.3350, -6.2950] as [number, number], severity: 'low' as const, name: 'RSUD Karawang (akses ramai)' },
  { center: [107.3450, -6.2950] as [number, number], severity: 'low' as const, name: 'Tugu VW (simpang sibuk)' },
];

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function scoreRouteSafety(steps: any[]): { safetyScore: number; hazardWarnings: { name: string; severity: string; distanceKm: number }[] } {
  const WARNING_RADIUS_KM = 3;
  const warnings: { name: string; severity: string; distanceKm: number }[] = [];

  for (const step of steps) {
    const loc: [number, number] | null =
      step?.maneuver?.location ?? step?.intersections?.[0]?.location ?? null;
    if (!loc) continue;
    for (const hazard of HAZARD_HOTSPOTS) {
      const dist = haversineKm(loc, hazard.center);
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
    return res.status(200).end();
  }

  const { origin, destination } = req.body;

  if (!origin || !destination) {
    return res.status(400).json({ error: 'Origin and destination required' });
  }

  // Server-side: use MAPBOX_ACCESS_TOKEN (VITE_ prefix is for client-side only)
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) {
    return res.status(500).json({ error: 'Mapbox token tidak dikonfigurasi di server' });
  }

  const originStr = `${origin[0]},${origin[1]}`;
  const destStr = `${destination[0]},${destination[1]}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originStr};${destStr}?geometries=geojson&overview=full&steps=true&language=id&alternatives=true&access_token=${mapboxToken}`;

  console.log(`🚗 Directions: ${originStr} → ${destStr}`);

  try {
    const response = await fetch(url);

    if (response.status === 402) {
      console.error('❌ Mapbox 402 — Directions API not available on this token');
      return res.status(402).json({
        error: 'Directions API tidak tersedia. Token Mapbox Anda tidak memiliki akses Directions API. Silakan upgrade ke paket yang mencakup Directions API.',
        code: 'DIRECTIONS_UNAVAILABLE',
      });
    }

    const data = await response.json();

    if (data.message) {
      return res.status(500).json({ error: data.message });
    }

    if (!data.routes || data.routes.length === 0) {
      return res.status(500).json({ error: 'No routes found' });
    }

    const scoredRoutes = data.routes.map((route: any) => {
      const steps = route.legs?.[0]?.steps || [];
      const { safetyScore, hazardWarnings } = scoreRouteSafety(steps);
      return { ...route, safetyScore, hazardWarnings };
    });

    // Pick fastest route (or safest if preferHazards)
    const selected = scoredRoutes.reduce(
      (best: any, r: any) => (r.duration < best.duration ? r : best),
      scoredRoutes[0]
    );

    const allRoutes = scoredRoutes.map((r: any) => ({
      geometry: r.geometry,
      duration: r.duration,
      distance: r.distance,
      distance_km: (r.distance / 1000).toFixed(1),
      eta_text: (() => {
        const mins = Math.round(r.duration / 60);
        return mins >= 60 ? `${Math.floor(mins / 60)}j ${mins % 60}m` : `${mins} menit`;
      })(),
      legs: r.legs,
      safetyScore: r.safetyScore,
      hazardWarnings: r.hazardWarnings,
    }));

    const best = allRoutes[0];
    console.log(`✅ Route: ${best.distance_km}km, safety=${best.safetyScore}, ${best.hazardWarnings.length} warnings`);

    return res.json({
      routes: allRoutes,
      selectedRouteIndex: 0,
      safetySummary: {
        score: best.safetyScore,
        label: best.safetyScore >= 80 ? 'Sangat Aman' : best.safetyScore >= 60 ? 'Cukup Aman' : best.safetyScore >= 40 ? 'Hati-Hati' : 'Rute Berisiko',
        warnings: best.hazardWarnings.slice(0, 3),
      },
    });
  } catch (err: any) {
    console.error('❌ Directions error:', err);
    return res.status(500).json({ error: err.message });
  }
}