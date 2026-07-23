import type { RenderSpecV1 } from "./render-spec";
import { getTotalDuration } from "./render-spec";

export type TimelineScene =
  | "intro"
  | "origin"
  | "flight"
  | "destination"
  | "outro";

export type TimelineFrame = {
  scene: TimelineScene;
  sceneProgress: number;
  totalProgress: number;
  routeProgress: number;
  overlayOpacity: number;
  cameraProgress: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function easeInOutCubic(t: number) {
  const value = clamp01(t);
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

export function evaluateTimeline(spec: RenderSpecV1, timeMs: number): TimelineFrame {
  const timings = spec.timings;
  const total = getTotalDuration(timings);
  const time = Math.min(total, Math.max(0, timeMs));
  const introEnd = timings.introMs;
  const originEnd = introEnd + timings.originHoldMs;
  const flightEnd = originEnd + timings.flightMs;
  const destinationEnd = flightEnd + timings.destinationHoldMs;

  if (time < introEnd) {
    const progress = clamp01(time / timings.introMs);
    return {
      scene: "intro",
      sceneProgress: progress,
      totalProgress: time / total,
      routeProgress: 0,
      overlayOpacity: Math.sin(Math.PI * progress),
      cameraProgress: 0,
    };
  }

  if (time < originEnd) {
    const progress = clamp01((time - introEnd) / timings.originHoldMs);
    return {
      scene: "origin",
      sceneProgress: progress,
      totalProgress: time / total,
      routeProgress: 0,
      overlayOpacity: 1,
      cameraProgress: easeOutCubic(progress) * 0.12,
    };
  }

  if (time < flightEnd) {
    const progress = clamp01((time - originEnd) / timings.flightMs);
    return {
      scene: "flight",
      sceneProgress: progress,
      totalProgress: time / total,
      routeProgress: easeInOutCubic(progress),
      overlayOpacity: 1,
      cameraProgress: 0.12 + easeInOutCubic(progress) * 0.76,
    };
  }

  if (time < destinationEnd) {
    const progress = clamp01((time - flightEnd) / timings.destinationHoldMs);
    return {
      scene: "destination",
      sceneProgress: progress,
      totalProgress: time / total,
      routeProgress: 1,
      overlayOpacity: 1,
      cameraProgress: 0.88 + easeOutCubic(progress) * 0.12,
    };
  }

  const progress = clamp01((time - destinationEnd) / timings.outroMs);
  return {
    scene: "outro",
    sceneProgress: progress,
    totalProgress: time / total,
    routeProgress: 1,
    overlayOpacity: Math.sin(Math.PI * clamp01(progress * 0.85 + 0.1)),
    cameraProgress: 1,
  };
}
