import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory custom locations store
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
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'alun-alun-karawang-1',
    name: 'Alun-Alun Karawang',
    place_name: 'Alun-Alun Karawang, Jawa Barat, Indonesia',
    center: [107.3380, -6.3100],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'rsud-karawang-1',
    name: 'RSUD Karawang',
    place_name: 'Rumah Sakit Umum Daerah Karawang, Jawa Barat',
    center: [107.3350, -6.2950],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tol-karawang-1',
    name: 'Gerbang Tol Karawang',
    place_name: 'Gerbang Tol Karawang, Jawa Barat, Indonesia',
    center: [107.3850, -6.2850],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'horizon-university-karawang',
    name: 'Horizon University Indonesia',
    place_name: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass KM.1, Tanjungpura, Karawang Barat, Jawa Barat 41316',
    center: [107.29258097454206, -6.289202887118927],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

// Default center: Karawang
const DEFAULT_CENTER = '107.3371,-6.3065';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query, proximity } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }

  console.log(`🔍 Geocode: "${query}" proximity=${proximity || DEFAULT_CENTER}`);

  // Server-side: use MAPBOX_ACCESS_TOKEN (VITE_ prefix is for client-side only)
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) {
    console.error('❌ Mapbox token missing');
    return res.status(500).json({ error: 'Mapbox token tidak dikonfigurasi di server' });
  }

  // Search custom locations first
  const q = (query as string).toLowerCase();
  const customResults = customLocations
    .filter(
      (loc) =>
        loc.name.toLowerCase().includes(q) || loc.place_name.toLowerCase().includes(q)
    )
    .map((loc) => ({
      id: loc.id,
      text: loc.name,
      place_name: loc.place_name,
      center: loc.center,
      properties: { custom: true },
      full_address: loc.place_name,
    }));

  const proximityCoords = (proximity as string) || DEFAULT_CENTER;
  const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query as string)}.json?access_token=${mapboxToken}&country=id&language=id&types=poi,address,place,locality,neighborhood&proximity=${proximityCoords}&limit=10`;

  let mapboxFeatures: any[] = [];

  try {
    const response = await fetch(geocodeUrl);
    const data = await response.json();

    if (data.message) {
      console.error('❌ Mapbox error:', data.message);
      if (customResults.length > 0) {
        return res.json({ features: customResults });
      }
      return res.status(500).json({ error: data.message });
    }

    // Enrich Mapbox features with full address
    mapboxFeatures = (data.features || []).map((feature: any) => {
      const context = feature.context || [];
      const regionContext = context.find((c: any) => c.id.includes('region'))?.text || '';
      const districtContext = context.find((c: any) => c.id.includes('district'))?.text || '';
      const placeContext = context.find((c: any) => c.id.includes('place'))?.text || '';
      const localityContext = context.find((c: any) => c.id.includes('locality'))?.text || '';
      const postcodeContext = context.find((c: any) => c.id.includes('postcode'))?.text || '';

      let fullAddress = feature.place_name;
      if (fullAddress.split(',').length < 3) {
        const parts = [
          feature.text,
          localityContext || districtContext,
          placeContext,
          regionContext,
          'Indonesia',
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
  } catch (err: any) {
    console.error('❌ Geocode fetch error:', err);
    if (customResults.length > 0) {
      return res.json({ features: customResults });
    }
    return res.status(500).json({ error: err.message });
  }

  // Deduplicate
  const customIds = new Set(customResults.map((r) => r.id));
  const newMapboxResults = mapboxFeatures.filter((f) => !customIds.has(f.id));

  const allFeatures = [...customResults, ...newMapboxResults];
  console.log(`✅ Returning ${allFeatures.length} results (${customResults.length} custom + ${newMapboxResults.length} Mapbox)`);

  return res.json({ features: allFeatures });
}