import type { AspectRatio, RoutePoint } from "./render-spec";
import { bearingBetween, pointAlongRoute } from "./route-geometry";
import type { TimelineFrame } from "./timeline";

export type OverviewCamera = {
  center: RoutePoint;
  zoom: number;
};

export type CinematicCameraPose = {
  center: RoutePoint;
  zoom: number;
  pitch: number;
  bearing: number;
};

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function interpolateLongitude(start: number, end: number, progress: number) {
  let adjustedEnd = end;
  while (adjustedEnd - start > 180) adjustedEnd -= 360;
  while (adjustedEnd - start < -180) adjustedEnd += 360;
  return lerp(start, adjustedEnd, progress);
}

function interpolatePoint(start: RoutePoint, end: RoutePoint, progress: number): RoutePoint {
  return [
    interpolateLongitude(start[0], end[0], progress),
    lerp(start[1], end[1], progress),
  ];
}

function interpolateBearing(start: number, end: number, progress: number) {
  let delta = end - start;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return start + delta * progress;
}

/**
 * Hermite smoothstep — returns 0 when x ≤ edge0, 1 when x ≥ edge1,
 * and a smooth S-curve with zero first-derivative at both edges.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Single continuous "pan shot" camera.
 *
 * Instead of switching between discrete scene-specific camera behaviours
 * (which causes visible snaps at every scene boundary), this function
 * blends smoothly between an overview pose and a route-tracking pose
 * using a single blend curve driven by `totalProgress`.
 *
 * The result is one unbroken camera move:
 *   overview → zoom-in → track the plane → zoom-out → overview
 */
export function getCinematicCameraPose(
  route: RoutePoint[],
  timeline: TimelineFrame,
  overview: OverviewCamera,
  aspectRatio: AspectRatio
): CinematicCameraPose {
  const portrait = aspectRatio === "9:16";
  const trackingZoom = Math.max(
    overview.zoom + (portrait ? 1.15 : 1.75),
    portrait ? 3.65 : 4.2
  );
  const trackingPitch = portrait ? 48 : 54;

  // totalProgress runs 0→1 linearly over the entire animation duration.
  const tp = timeline.totalProgress;
  // routeProgress is the eased 0→1 position of the plane along the route.
  const rp = timeline.routeProgress;

  // ── Blend curve ─────────────────────────────────────────────
  // Smoothly ramp from 0 (overview) to 1 (tracking) during the
  // first ~22% of the total time, and back down during the last ~20%.
  const blendIn = smoothstep(0, 0.22, tp);
  const blendOut = smoothstep(1.0, 0.80, tp);
  const blend = Math.min(blendIn, blendOut);

  // ── Route position & heading ────────────────────────────────
  const { point: routePoint } = pointAlongRoute(route, rp);
  const behindPoint = pointAlongRoute(route, Math.max(0, rp - 0.03)).point;
  const aheadPoint = pointAlongRoute(route, Math.min(1, rp + 0.03)).point;

  // Bearing from a look-behind to a look-ahead for a smooth heading
  const heading = bearingBetween(behindPoint, aheadPoint);

  // Tracking center sits slightly ahead of the plane
  const trackingCenter: RoutePoint = [
    routePoint[0] + (aheadPoint[0] - routePoint[0]) * 0.25,
    routePoint[1] + (aheadPoint[1] - routePoint[1]) * 0.25,
  ];

  // Subtle zoom wave during the tracked phase for a cinematic feel
  const trackPhase = Math.max(0, Math.min(1, (tp - 0.22) / 0.58));
  const zoomWave = Math.sin(Math.PI * trackPhase) * 0.28;

  return {
    center: interpolatePoint(overview.center, trackingCenter, blend),
    zoom: lerp(overview.zoom, trackingZoom + zoomWave, blend),
    pitch: lerp(0, trackingPitch, blend),
    bearing: interpolateBearing(0, heading, blend),
  };
}
