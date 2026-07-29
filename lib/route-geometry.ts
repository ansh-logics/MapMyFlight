import type { RoutePoint } from "./render-spec";

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function createGreatCircle(
  start: RoutePoint,
  end: RoutePoint,
  points = 180
): RoutePoint[] {
  const lng1 = toRadians(start[0]);
  const lat1 = toRadians(start[1]);
  const lng2 = toRadians(end[0]);
  const lat2 = toRadians(end[1]);
  const a: [number, number, number] = [
    Math.cos(lat1) * Math.cos(lng1),
    Math.cos(lat1) * Math.sin(lng1),
    Math.sin(lat1),
  ];
  const b: [number, number, number] = [
    Math.cos(lat2) * Math.cos(lng2),
    Math.cos(lat2) * Math.sin(lng2),
    Math.sin(lat2),
  ];
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  let previousLng = start[0];

  return Array.from({ length: Math.max(2, points) }, (_, index) => {
    const t = index / (Math.max(2, points) - 1);
    if (sinOmega < 0.000001) {
      return [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
    }
    const scaleA = Math.sin((1 - t) * omega) / sinOmega;
    const scaleB = Math.sin(t * omega) / sinOmega;
    const x = scaleA * a[0] + scaleB * b[0];
    const y = scaleA * a[1] + scaleB * b[1];
    const z = scaleA * a[2] + scaleB * b[2];
    let lng = toDegrees(Math.atan2(y, x));
    const lat = toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)));
    while (lng - previousLng > 180) lng -= 360;
    while (lng - previousLng < -180) lng += 360;
    previousLng = lng;
    return [lng, lat];
  });
}

export function pointAlongRoute(route: RoutePoint[], progress: number) {
  if (!route.length) return { point: [0, 0] as RoutePoint, index: 0 };
  const scaled = Math.min(1, Math.max(0, progress)) * (route.length - 1);
  const index = Math.min(route.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = route[index];
  const b = route[Math.min(route.length - 1, index + 1)];
  return {
    point: [
      a[0] + (b[0] - a[0]) * local,
      a[1] + (b[1] - a[1]) * local,
    ] as RoutePoint,
    index,
  };
}

export function bearingBetween(start: RoutePoint, end: RoutePoint) {
  const lng1 = toRadians(start[0]);
  const lng2 = toRadians(end[0]);
  const lat1 = toRadians(start[1]);
  const lat2 = toRadians(end[1]);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function routeGeoJson(route: RoutePoint[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: route },
  };
}

/**
 * Compute the bearing as it visually appears on a Mercator map.
 * Standard geographic bearing (great-circle tangent) doesn't match the
 * on-screen direction of a drawn route because Mercator stretches latitudes.
 * This converts lat to Mercator Y before computing the angle.
 */
export function mercatorBearing(start: RoutePoint, end: RoutePoint): number {
  const toRad = Math.PI / 180;
  const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));
  const dx = end[0] - start[0];
  const dy = mercY(end[1]) - mercY(start[1]);
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Get a smooth Mercator bearing along the route at a given progress,
 * using a look-behind/look-ahead window to avoid discrete segment snaps.
 */
export function smoothMercatorBearing(
  route: RoutePoint[],
  progress: number,
  windowSize = 0.018
): number {
  const behind = pointAlongRoute(route, Math.max(0, progress - windowSize)).point;
  const ahead = pointAlongRoute(route, Math.min(1, progress + windowSize)).point;
  const dx = Math.abs(ahead[0] - behind[0]);
  const dy = Math.abs(ahead[1] - behind[1]);
  if (dx < 1e-12 && dy < 1e-12) {
    const { index } = pointAlongRoute(route, progress);
    return mercatorBearing(route[index], route[Math.min(index + 1, route.length - 1)]);
  }
  return mercatorBearing(behind, ahead);
}

