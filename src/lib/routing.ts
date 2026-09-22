export type TransportMode = "driving" | "walking" | "cycling";

export interface RouteResult {
  durationMinutes: number;
  distanceKm: number;
  provider: "mapbox" | "osrm";
  geometry?: any;
}

export async function fetchRealtimeRoute(
  startLat: number,
  startLon: number,
  destLat: number,
  destLon: number,
  mode: TransportMode = "driving",
  mapboxToken?: string | null
): Promise<RouteResult> {
  const token = mapboxToken || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

  // 1. Try Mapbox Directions API if token exists
  if (token) {
    let mapboxProfile = "mapbox/driving-traffic";
    if (mode === "walking") mapboxProfile = "mapbox/walking";
    if (mode === "cycling") mapboxProfile = "mapbox/cycling";

    try {
      const url = `https://api.mapbox.com/directions/v5/${mapboxProfile}/${startLon},${startLat};${destLon},${destLat}?access_token=${encodeURIComponent(token)}&geometries=geojson`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const durationMinutes = Math.max(1, Math.round(route.duration / 60));
          const distanceKm = Number((route.distance / 1000).toFixed(1));
          return {
            durationMinutes,
            distanceKm,
            provider: "mapbox",
            geometry: route.geometry,
          };
        }
      }
    } catch (err) {
      console.warn("Mapbox directions fetch error, falling back to OSRM:", err);
    }
  }

  // 2. Fallback to OSRM with calibrated regional traffic heuristics
  let osrmProfile = "driving";
  if (mode === "walking") osrmProfile = "walking";
  if (mode === "cycling") osrmProfile = "cycling";

  try {
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLon},${startLat};${destLon},${destLat}?overview=false`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        let baseMinutes = route.duration / 60;

        // Apply traffic heuristics for driving if using OSRM
        if (mode === "driving") {
          const now = new Date();
          const hour = now.getHours() + now.getMinutes() / 60;
          // Peak rush hours: 07:30-09:30 and 17:00-19:30
          const isMorningRush = hour >= 7.5 && hour <= 9.5;
          const isEveningRush = hour >= 17.0 && hour <= 19.5;

          let trafficMultiplier = 1.15; // default urban traffic cushion
          if (isMorningRush || isEveningRush) {
            trafficMultiplier = 1.35; // peak rush hour congestion
          }
          baseMinutes = baseMinutes * trafficMultiplier;
        }

        const durationMinutes = Math.max(1, Math.round(baseMinutes));
        const distanceKm = Number((route.distance / 1000).toFixed(1));
        return {
          durationMinutes,
          distanceKm,
          provider: "osrm",
        };
      }
    }
  } catch (err) {
    console.error("OSRM fetch error:", err);
  }

  // Absolute safety fallback (e.g. offline estimate based on distance calculation)
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

  let speedKmH = 35; // driving
  if (mode === "walking") speedKmH = 4.5;
  if (mode === "cycling") speedKmH = 15;

  const fallbackMinutes = Math.max(1, Math.round((directDistKm / speedKmH) * 60));
  return {
    durationMinutes: fallbackMinutes,
    distanceKm: directDistKm,
    provider: "osrm",
  };
}
