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

function circularMean(angles: number[]) {
  let x = 0;
  let y = 0;
  for (const angle of angles) {
    x += Math.cos((angle * Math.PI) / 180);
    y += Math.sin((angle * Math.PI) / 180);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Steepest tilt the chase uses; pre-warming should match it. */
export function getTrackingPitch(aspectRatio: AspectRatio) {
  return aspectRatio === "9:16" ? 46 : 60;
}

/** Closest the camera gets during the chase; also used to pre-warm tiles. */
export function getTrackingZoom(overview: OverviewCamera, aspectRatio: AspectRatio) {
  const portrait = aspectRatio === "9:16";
  return Math.max(overview.zoom + (portrait ? 1.5 : 1.9), portrait ? 3.9 : 4.3);
}

/**
 * Single continuous camera move, written as a pure function of time so the
 * live preview and the frame-exact export always agree.
 *
 *   wide establishing push → descend onto the origin → chase the aircraft,
 *   craning up at cruise to reveal the distance → push in on arrival →
 *   pull back to the full route.
 *
 * Every stage blends through smoothsteps, so there are no snaps at scene
 * boundaries. While tracking, the camera also swings slowly from one side
 * of the aircraft to the other, which gives the terrain real parallax.
 */
export function getCinematicCameraPose(
  route: RoutePoint[],
  timeline: TimelineFrame,
  overview: OverviewCamera,
  aspectRatio: AspectRatio
): CinematicCameraPose {
  const portrait = aspectRatio === "9:16";
  const tp = timeline.totalProgress;
  const rp = timeline.routeProgress;
  const trackingZoom = getTrackingZoom(overview, aspectRatio);

  // How "inside the shot" the camera is: 0 = overview, 1 = chasing.
  const engage = smoothstep(0.05, 0.25, tp);
  const release = smoothstep(0.97, 0.79, tp);
  const blend = engage * release;

  // Cruise: 0 on the ground, 1 mid-route.
  const cruise = smoothstep(0, 0.4, rp) * smoothstep(1, 0.6, rp);

  // Heading: a wide circular average keeps the camera from twitching on
  // curvy great circles while still following the route's big turns.
  const sample = (offset: number) => pointAlongRoute(route, Math.min(1, Math.max(0, rp + offset))).point;
  const heading = circularMean([
    bearingBetween(sample(-0.08), sample(0.02)),
    bearingBetween(sample(-0.04), sample(0.04)),
    bearingBetween(sample(-0.02), sample(0.08)),
  ]);

  // Lead the aircraft so it sits in the lower third with room ahead of it.
  const lead = 0.018 + cruise * 0.022;
  const { point: aircraft } = pointAlongRoute(route, rp);
  const ahead = sample(lead);
  const trackingCenter: RoutePoint = [
    aircraft[0] + (ahead[0] - aircraft[0]) * 0.6,
    aircraft[1] + (ahead[1] - aircraft[1]) * 0.6,
  ];

  // Crane up at cruise, push in close for take-off and touchdown.
  const zoom = trackingZoom + 0.25 - cruise * 0.85;
  // Tall frames see much further toward the horizon, so portrait tilts less
  // (which also keeps tile loads reasonable for vertical exports).
  const pitch = getTrackingPitch(aspectRatio) - cruise * (portrait ? 8 : 12);
  // Slow orbit: start on one quarter, finish on the other.
  const orbit = (rp - 0.5) * (portrait ? 26 : 34);

  // The overview itself is never quite still: a gentle push at the start
  // and a slow pull-back at the end.
  const overviewZoom = overview.zoom - 0.3 * (1 - smoothstep(0, 0.12, tp)) - 0.12 * smoothstep(0.88, 1, tp);

  return {
    center: interpolatePoint(overview.center, trackingCenter, blend),
    zoom: lerp(overviewZoom, zoom, blend),
    pitch: lerp(0, pitch, blend),
    bearing: interpolateBearing(0, heading + orbit, blend),
  };
}
