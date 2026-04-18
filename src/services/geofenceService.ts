/**
 * Server-side geofence validation using the Haversine formula (great-circle distance).
 * Elevation is ignored; accuracy is suitable for branch check-in radii (default 30 m).
 */
 
const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export type GeofenceEvaluation = {
  accepted: boolean;
  distanceM: number;
  allowedRadiusM: number;
  /** If GPS accuracy (m) is worse than radius, we still reject — prevents spoof margin abuse */
  accuracyRejected?: boolean;
};

/**
 * Branch enforcement: employee must be within `allowedRadiusM` of branch coordinates.
 * Optional `accuracyM` from device: reject when accuracy is null or worse than radius (configurable strictness).
 */
export function evaluateGeofence(input: {
  employeeLat: number;
  employeeLon: number;
  branchLat: number;
  branchLon: number;
  allowedRadiusM: number;
  /** Horizontal accuracy reported by client, if available */
  accuracyM?: number | null;
  /** When true, null accuracy fails closed (production default for compliance-sensitive orgs) */
  rejectUnknownAccuracy?: boolean;
}): GeofenceEvaluation {
  const distanceM = haversineDistanceMeters(
    input.employeeLat,
    input.employeeLon,
    input.branchLat,
    input.branchLon,
  );

  const rejectUnknown = input.rejectUnknownAccuracy ?? true;
  if (rejectUnknown && (input.accuracyM == null || Number.isNaN(input.accuracyM))) {
    return {
      accepted: false,
      distanceM,
      allowedRadiusM: input.allowedRadiusM,
      accuracyRejected: true,
    };
  }

  if (input.accuracyM != null && input.accuracyM > input.allowedRadiusM) {
    return {
      accepted: false,
      distanceM,
      allowedRadiusM: input.allowedRadiusM,
      accuracyRejected: true,
    };
  }

  const accepted = distanceM <= input.allowedRadiusM;
  return { accepted, distanceM, allowedRadiusM: input.allowedRadiusM };
}
