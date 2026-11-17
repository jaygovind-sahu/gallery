/** Matching a photo's GPS position to a location the owner has used before. Pure; admin-only data. */

export interface LocationCentroid {
  locationId: string;
  lat: number;
  lng: number;
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The location whose earlier photos sit closest to this position, if any is within `maxKm`.
 * 5 km covers a large refuge without reaching the next park over.
 */
export function nearestLocation(lat: number | null, lng: number | null, centroids: readonly LocationCentroid[], maxKm = 5): string | null {
  if (lat === null || lng === null) return null;
  let best: { id: string; km: number } | null = null;
  for (const c of centroids) {
    const km = distanceKm(lat, lng, c.lat, c.lng);
    if (km <= maxKm && (!best || km < best.km)) best = { id: c.locationId, km };
  }
  return best?.id ?? null;
}
