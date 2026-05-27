import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory custom locations store (Karawang area)
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
    place_name: 'Alun-Alun Karawang, Jl. Jend. Ahmad Yani, Nagasari, Karawang Barat, Jawa Barat 41311',
    center: [107.3380, -6.3100],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'rsud-karawang-1',
    name: 'RSUD Karawang',
    place_name: 'Rumah Sakit Umum Daerah Karawang, Jl. Galuh No.1, Nagasari, Karawang Barat, Jawa Barat 41312',
    center: [107.3350, -6.2950],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'rs-karawang',
    name: 'RSUP Karawang',
    place_name: 'RSUP Karawang, Jl. Galuh No.1, Nagasari, Karawang Bar., Karawang, Jawa Barat 41312',
    center: [107.3170, -6.3060],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'tol-karawang-barat',
    name: 'Gerbang Tol Karawang Barat',
    place_name: 'Gerbang Tol Karawang Barat, Jalan Tol Trans Jawa, Karawang, Jawa Barat',
    center: [107.3450, -6.2930],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'tol-karawang-timur',
    name: 'Gerbang Tol Karawang Timur',
    place_name: 'Gerbang Tol Karawang Timur, Jalan Tol Trans Jawa, Karawang, Jawa Barat',
    center: [107.2650, -6.3250],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'mall-karawang',
    name: 'Resvi City Mall Karawang',
    place_name: 'Resvi City Mall Karawang, Jl. Tuparev, Nagarasari, Karawang Barat, Jawa Barat 41312',
    center: [107.3110, -6.3150],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'horizon-university',
    name: 'Horizon University Indonesia',
    place_name: 'Horizon University Indonesia, Jl. Pangkal Perjuangan By Pass KM.1, Tanjungpura, Karawang Barat, Jawa Barat 41316',
    center: [107.29258097454206, -6.289202887118927],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'alun2-karawang',
    name: 'Alun-Alun Karawang',
    place_name: 'Alun-Alun Karawang, Jl. Jend. A.Yani, Nagasari, Karawang Bar., Karawang, Jawa Barat 41311',
    center: [107.3070, -6.3090],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'stadt-celebes',
    name: 'Stadt Celebes Hotel Karawang',
    place_name: 'Stadt Celebes Hotel Karawang, Jl. Pangkal Perjuangan, Tanjungpura, Karawang Barat, Jawa Barat 41316',
    center: [107.2870, -6.2860],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'citra-insight',
    name: 'Citra Insight Technology',
    place_name: 'Citra Insight Technology, Jl. Pangkal Perjuangan By Pass KM.1,8, Tanjungpura, Karawang Barat, Jawa Barat 41316',
    center: [107.2960, -6.2915],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'kln-karawang',
    name: 'Kawasan Industri Karawang',
    place_name: 'Kawasan Industri Ngury, Telagasari, Karawang, Jawa Barat 41381',
    center: [107.3500, -6.3500],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'stt-karawang',
    name: 'STT Bandung - Kampus II Karawang',
    place_name: 'STT Bandung (Kampus II Karawang), Jl. Pangkal Perjuangan By Pass KM.2, Tanjungpura, Karawang Barat, Jawa Barat',
    center: [107.2850, -6.2855],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'tugu-vw',
    name: 'Tugu VW Karawang',
    place_name: 'Tugu VW, Karawang, Jawa Barat, Indonesia',
    center: [107.3450, -6.2950],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'pasar-karawang',
    name: 'Pasar Karyagem',
    place_name: 'Pasar Karyagem, Karawang, Jawa Barat',
    center: [107.3360, -6.3080],
    addedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

// Default center: Karawang, West Java
const DEFAULT_CENTER: [number, number] = [107.3371, -6.3065];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { query, proximity } = req.query;

    if (!query || typeof query !== 'string') {
      // Return popular Karawang locations for empty queries
      const presets = customLocations.slice(0, 8).map(loc => ({
        id: loc.id,
        text: loc.name,
        place_name: loc.place_name,
        center: loc.center,
        full_address: loc.place_name,
        city: 'Karawang',
        region: 'Jawa Barat',
        properties: { custom: true }
      }));
      return res.status(200).json({ features: presets });
    }

    console.log(`Geocode request: "${query}" (proximity: ${proximity})`);

    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
      console.error('Mapbox token not found');
      // Fallback: return custom locations only
      const results = customLocations
        .filter(loc => loc.name.toLowerCase().includes(query.toLowerCase()) || loc.place_name.toLowerCase().includes(query.toLowerCase()))
        .map(loc => ({
          id: loc.id,
          text: loc.name,
          place_name: loc.place_name,
          center: loc.center,
          full_address: loc.place_name,
          city: 'Karawang',
          region: 'Jawa Barat',
          properties: { custom: true }
        }));
      return res.status(200).json({ features: results });
    }

    // Search custom locations
    const q = query.toLowerCase();
    const customResults = customLocations
      .filter(loc => loc.name.toLowerCase().includes(q) || loc.place_name.toLowerCase().includes(q))
      .map(loc => ({
        id: loc.id,
        text: loc.name,
        place_name: loc.place_name,
        center: loc.center,
        full_address: loc.place_name,
        city: 'Karawang',
        region: 'Jawa Barat',
        properties: { custom: true }
      }));

    // Use proximity from request or default to Karawang
    const proximityCoords = proximity || `${DEFAULT_CENTER[0]},${DEFAULT_CENTER[1]}`;

    // Call Mapbox Geocoding API
    const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&country=id&language=id&types=poi,address,place,locality,neighborhood&proximity=${proximityCoords}&limit=10`;

    console.log(`Calling Mapbox Geocoding API...`);
    const response = await fetch(geocodeUrl);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.message) {
      console.error('Mapbox API error:', data.message);
      // Return custom results as fallback
      return res.status(200).json({ features: customResults });
    }

    // Enrich Mapbox features with complete address
    let mapboxFeatures = (data.features || []).map((feature: any) => {
      const context = feature.context || [];
      let fullAddress = feature.place_name;

      const regionContext = context.find((c: any) => c.id.includes('region'))?.text || '';
      const districtContext = context.find((c: any) => c.id.includes('district'))?.text || '';
      const placeContext = context.find((c: any) => c.id.includes('place'))?.text || '';
      const localityContext = context.find((c: any) => c.id.includes('locality'))?.text || '';
      const postcodeContext = context.find((c: any) => c.id.includes('postcode'))?.text || '';

      if (fullAddress.split(',').length < 3) {
        const parts = [
          feature.text,
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

    // Deduplicate Mapbox results against custom results
    const customIds = new Set(customResults.map(r => r.id));
    mapboxFeatures = mapboxFeatures.filter((f: any) => !customIds.has(f.id));

    const allFeatures = [...customResults, ...mapboxFeatures];

    console.log(`Returning ${allFeatures.length} results (${customResults.length} custom + ${mapboxFeatures.length} Mapbox)`);

    res.status(200).json({ features: allFeatures });
  } catch (error: any) {
    console.error('Geocoding error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}