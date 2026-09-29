export type TransportMode = "driving" | "walking" | "cycling";

export interface RouteResult {
  durationMinutes: number;
  distanceKm: number;
  provider: "mapbox" | "osrm";
  geometry?: any;
}

// In-memory route duration cache (5 minutes TTL)
const routeCache = new Map<string, { durationMinutes: number; distanceKm: number; timestamp: number }>();

export async function fetchRealtimeRoute(
  startLat: number,
  startLon: number,
  destLat: number,
  destLon: number,
  mode: TransportMode = "driving",
  mapboxToken?: string | null
): Promise<RouteResult> {
  const cacheKey = `${startLat.toFixed(4)},${startLon.toFixed(4)}->${destLat.toFixed(4)},${destLon.toFixed(4)}:${mode}`;
  const nowTs = Date.now();
  const cached = routeCache.get(cacheKey);

  if (cached && nowTs - cached.timestamp < 5 * 60 * 1000) {
    return {
      durationMinutes: cached.durationMinutes,
      distanceKm: cached.distanceKm,
      provider: "mapbox",
    };
  }

  // Calculate instant offline fallback (haversine formula) in case network is slow
  const R = 6371; // Earth radius km
  const dLat = ((destLat - startLat) * Math.PI) / 180;
  const dLon = ((destLon - startLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((startLat * Math.PI) / 180) *
      Math.cos((destLat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const directDistKm = Number((R * c).toFixed(1));

  let speedKmH = 30; // driving city speed ~30 km/h
  if (mode === "walking") speedKmH = 4.5;
  if (mode === "cycling") speedKmH = 15;

  const fallbackMinutes = Math.max(1, Math.round((directDistKm / speedKmH) * 60));
  const fallbackResult: RouteResult = {
    durationMinutes: fallbackMinutes,
    distanceKm: directDistKm,
    provider: "osrm",
  };

  const token = mapboxToken || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

  // 1. Try Mapbox Directions API if token exists (with strict 3.5s timeout)
  if (token) {
    let mapboxProfile = "mapbox/driving-traffic";
    if (mode === "walking") mapboxProfile = "mapbox/walking";
    if (mode === "cycling") mapboxProfile = "mapbox/cycling";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const url = `https://api.mapbox.com/directions/v5/${mapboxProfile}/${startLon},${startLat};${destLon},${destLat}?access_token=${encodeURIComponent(token)}&geometries=geojson`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const durationMinutes = Math.max(1, Math.round(route.duration / 60));
          const distanceKm = Number((route.distance / 1000).toFixed(1));
          
          routeCache.set(cacheKey, { durationMinutes, distanceKm, timestamp: nowTs });

          return {
            durationMinutes,
            distanceKm,
            provider: "mapbox",
            geometry: route.geometry,
          };
        }
      }
    } catch (err) {
      console.warn("Mapbox directions fetch error/timeout, attempting OSRM fallback:", err);
    }
  }

  // 2. Fallback to OSRM with calibrated regional traffic heuristics (3.5s timeout)
  let osrmProfile = "driving";
  if (mode === "walking") osrmProfile = "walking";
  if (mode === "cycling") osrmProfile = "cycling";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLon},${startLat};${destLon},${destLat}?overview=false`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        let baseMinutes = route.duration / 60;

        if (mode === "driving") {
          const now = new Date();
          const hour = now.getHours() + now.getMinutes() / 60;
          const isMorningRush = hour >= 7.5 && hour <= 9.5;
          const isEveningRush = hour >= 17.0 && hour <= 19.5;

          let trafficMultiplier = 1.15;
          if (isMorningRush || isEveningRush) {
            trafficMultiplier = 1.35;
          }
          baseMinutes = baseMinutes * trafficMultiplier;
        }

        const durationMinutes = Math.max(1, Math.round(baseMinutes));
        const distanceKm = Number((route.distance / 1000).toFixed(1));

        routeCache.set(cacheKey, { durationMinutes, distanceKm, timestamp: nowTs });

        return {
          durationMinutes,
          distanceKm,
          provider: "osrm",
        };
      }
    }
  } catch (err) {
    console.error("OSRM fetch error/timeout:", err);
  }

  // Return instant offline calculation if both APIs timed out or failed
  return fallbackResult;
}
