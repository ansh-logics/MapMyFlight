import type { AspectRatio, RoutePoint } from "./render-spec";
import { bearingBetween, pointAlongRoute } from "./route-geometry";
import type { TimelineFrame } from "./timeline";
import { easeInOutCubic, easeOutCubic } from "./timeline";

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

export function getCinematicCameraPose(
  route: RoutePoint[],
  timeline: TimelineFrame,
  overview: OverviewCamera,
  aspectRatio: AspectRatio
): CinematicCameraPose {
  const start = route[0] ?? overview.center;
  const end = route[route.length - 1] ?? overview.center;
  const portrait = aspectRatio === "9:16";
  const trackingZoom = Math.max(overview.zoom + (portrait ? 1.15 : 1.75), portrait ? 3.65 : 4.2);
  const trackingPitch = portrait ? 52 : 58;

  if (timeline.scene === "intro") {
    return { ...overview, pitch: 0, bearing: 0 };
  }

  if (timeline.scene === "origin") {
    const progress = easeOutCubic(timeline.sceneProgress);
    const firstLeg = route[Math.min(4, route.length - 1)] ?? end;
    const heading = bearingBetween(start, firstLeg);
    return {
      center: interpolatePoint(overview.center, start, progress),
      zoom: lerp(overview.zoom, trackingZoom, progress),
      pitch: lerp(0, trackingPitch, progress),
      bearing: interpolateBearing(0, heading - 16, progress),
    };
  }

  if (timeline.scene === "flight") {
    const current = pointAlongRoute(route, timeline.routeProgress);
    const lookAhead = pointAlongRoute(route, Math.min(1, timeline.routeProgress + 0.035));
    const next = route[Math.min(current.index + 1, route.length - 1)] ?? end;
    const heading = bearingBetween(route[current.index] ?? start, next);
    return {
      center: interpolatePoint(current.point, lookAhead.point, 0.28),
      zoom: trackingZoom + Math.sin(Math.PI * timeline.sceneProgress) * 0.34,
      pitch: trackingPitch,
      bearing: heading - 16,
    };
  }

  if (timeline.scene === "destination") {
    const finalLeg = route[Math.max(0, route.length - 5)] ?? start;
    const heading = bearingBetween(finalLeg, end);
    const pullback = easeInOutCubic(Math.max(0, (timeline.sceneProgress - 0.45) / 0.55));
    return {
      center: interpolatePoint(end, overview.center, pullback),
      zoom: lerp(trackingZoom + 0.22, overview.zoom + 0.35, pullback),
      pitch: lerp(trackingPitch, 18, pullback),
      bearing: interpolateBearing(heading - 16, 0, pullback),
    };
  }

  const progress = easeInOutCubic(timeline.sceneProgress);
  return {
    center: interpolatePoint(end, overview.center, progress),
    zoom: lerp(overview.zoom + 0.35, overview.zoom, progress),
    pitch: lerp(18, 0, progress),
    bearing: 0,
  };
}
