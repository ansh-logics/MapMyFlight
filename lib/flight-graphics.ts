import type { RenderSpecV1, RoutePoint } from "./render-spec";
import { pointAlongRoute } from "./route-geometry";
import type { TimelineFrame } from "./timeline";

/**
 * Shared 2D drawing for everything that moves on top of the map: the
 * aircraft, its ground shadow, the glowing trail and the airport pulses.
 *
 * Both the live preview (an overlay canvas above Mapbox) and the frame-exact
 * export call `drawFlightOverlay`, so the two can never drift apart. Every
 * value is a pure function of the timeline, which keeps exports deterministic.
 */

type ScreenPoint = { x: number; y: number };

export type FlightOverlayInput = {
  ctx: CanvasRenderingContext2D;
  /** Projects a lng/lat to canvas pixels for the current camera. */
  project: (point: RoutePoint) => ScreenPoint;
  route: RoutePoint[];
  timeline: TimelineFrame;
  spec: RenderSpecV1;
  /** Resolution unit: 1 at 1920×1080, scaled for other canvas sizes. */
  unit: number;
  timeMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 0 on the ground, 1 at cruise — climbs out and descends in over ~14% of the route. */
export function flightAltitude(routeProgress: number) {
  return smoothstep(0, 0.14, routeProgress) * smoothstep(1, 0.86, routeProgress);
}

function screenBearing(a: ScreenPoint, b: ScreenPoint) {
  return ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;
}

function angleDelta(from: number, to: number) {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function hexToRgb(color: string) {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.padEnd(6, "0");
  const value = Number.parseInt(full.slice(0, 6), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function shade(color: string, amount: number) {
  const { r, g, b } = hexToRgb(color);
  const mix = (channel: number) =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function rgba(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Top-down airliner silhouette, nose toward -y, roughly 2s long and 1.9s wide. */
function traceAirframe(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  // Fuselage (right half, nose to tail)
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.06, -s * 0.98, s * 0.09, -s * 0.86, s * 0.09, -s * 0.7);
  // Right wing: swept leading edge, squared tip, swept trailing edge
  ctx.lineTo(s * 0.09, -s * 0.2);
  ctx.lineTo(s * 0.94, s * 0.24);
  ctx.quadraticCurveTo(s * 0.98, s * 0.27, s * 0.95, s * 0.33);
  ctx.lineTo(s * 0.09, s * 0.14);
  // Rear fuselage to the tailplane
  ctx.lineTo(s * 0.075, s * 0.62);
  ctx.lineTo(s * 0.4, s * 0.83);
  ctx.quadraticCurveTo(s * 0.42, s * 0.88, s * 0.38, s * 0.9);
  ctx.lineTo(s * 0.05, s * 0.86);
  ctx.quadraticCurveTo(s * 0.03, s * 1.0, 0, s * 1.02);
  // Mirror back up the left side
  ctx.quadraticCurveTo(-s * 0.03, s * 1.0, -s * 0.05, s * 0.86);
  ctx.lineTo(-s * 0.38, s * 0.9);
  ctx.quadraticCurveTo(-s * 0.42, s * 0.88, -s * 0.4, s * 0.83);
  ctx.lineTo(-s * 0.075, s * 0.62);
  ctx.lineTo(-s * 0.09, s * 0.14);
  ctx.lineTo(-s * 0.95, s * 0.33);
  ctx.quadraticCurveTo(-s * 0.98, s * 0.27, -s * 0.94, s * 0.24);
  ctx.lineTo(-s * 0.09, -s * 0.2);
  ctx.lineTo(-s * 0.09, -s * 0.7);
  ctx.bezierCurveTo(-s * 0.09, -s * 0.86, -s * 0.06, -s * 0.98, 0, -s);
  ctx.closePath();
}

function traceEngines(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.roundRect(side * s * 0.38 - s * 0.055, -s * 0.12, s * 0.11, s * 0.26, s * 0.05);
  }
}

type AircraftPose = {
  x: number;
  y: number;
  bearing: number;
  bank: number;
  altitude: number;
  opacity: number;
  color: string;
  size: number;
  timeMs: number;
};

function drawAircraft(ctx: CanvasRenderingContext2D, pose: AircraftPose) {
  const { x, y, bearing, bank, altitude, opacity, color, timeMs } = pose;
  if (opacity <= 0.001) return;
  // The aircraft grows a touch as it climbs toward the camera.
  const s = pose.size * (1 + altitude * 0.22);
  const bankRad = (bank * Math.PI) / 180;
  const wingScale = Math.max(0.78, Math.cos(bankRad));
  const rotation = (bearing * Math.PI) / 180;

  // A faint warm halo keeps the aircraft legible on dark maps, where a
  // black shadow would disappear.
  ctx.save();
  const haloRadius = s * 1.5;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, haloRadius);
  halo.addColorStop(0, `rgba(255, 236, 205, ${0.2 * opacity})`);
  halo.addColorStop(1, "rgba(255, 236, 205, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ground shadow: drifts away from the aircraft and softens with altitude.
  // Drawn by offsetting a far-away silhouette's shadow back into place, which
  // blurs reliably in every browser's 2D canvas.
  const far = 100_000;
  const shadowDistance = s * (0.28 + altitude * 1.7);
  ctx.save();
  ctx.globalAlpha = opacity * (0.55 - altitude * 0.22);
  ctx.shadowColor = "rgba(0, 0, 0, 1)";
  ctx.shadowBlur = s * (0.12 + altitude * 0.55);
  ctx.shadowOffsetX = far + shadowDistance * 0.55;
  ctx.shadowOffsetY = shadowDistance;
  ctx.translate(x - far, y);
  ctx.rotate(rotation);
  ctx.scale(wingScale, 1);
  traceAirframe(ctx, pose.size);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(wingScale, 1);

  // Body: lit from one side, the lit side follows the bank.
  const light = clamp(0.5 - bank / 60, 0.15, 0.85);
  const body = ctx.createLinearGradient(-s, 0, s, 0);
  body.addColorStop(0, shade(color, -0.32));
  body.addColorStop(light, shade(color, 0.18));
  body.addColorStop(1, shade(color, -0.22));
  traceAirframe(ctx, s);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.stroke();

  traceEngines(ctx, s);
  ctx.fillStyle = shade(color, -0.42);
  ctx.fill();

  // Spine highlight and tail fin.
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.84);
  ctx.lineTo(0, s * 0.5);
  ctx.stroke();
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.6);
  ctx.lineTo(0, s * 0.98);
  ctx.stroke();
  ctx.restore();

  // Navigation lights (red port, green starboard) and a tail strobe.
  const lights: { lx: number; ly: number; color: string; on: boolean }[] = [
    { lx: -s * 0.95 * wingScale, ly: s * 0.3, color: "255, 72, 72", on: true },
    { lx: s * 0.95 * wingScale, ly: s * 0.3, color: "72, 255, 140", on: true },
    { lx: 0, ly: s * 1.02, color: "255, 255, 255", on: timeMs % 1300 < 90 },
  ];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  for (const lamp of lights) {
    if (!lamp.on) continue;
    const radius = s * 0.16;
    const glow = ctx.createRadialGradient(lamp.lx, lamp.ly, 0, lamp.lx, lamp.ly, radius);
    glow.addColorStop(0, `rgba(${lamp.color}, ${0.95 * opacity})`);
    glow.addColorStop(0.35, `rgba(${lamp.color}, ${0.35 * opacity})`);
    glow.addColorStop(1, `rgba(${lamp.color}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lamp.lx, lamp.ly, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A soft comet-like glow trailing the aircraft along the drawn route. */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  points: ScreenPoint[],
  color: string,
  width: number,
  strength: number
) {
  if (points.length < 2 || strength <= 0.001) return;
  const tail = points[0];
  const head = points[points.length - 1];
  if (Math.hypot(head.x - tail.x, head.y - tail.y) < 1) return;
  // One continuous stroke with a gradient from tail to aircraft avoids the
  // bright beads you get from overlapping per-segment strokes.
  const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  gradient.addColorStop(0, rgba(color, 0));
  gradient.addColorStop(0.7, rgba(color, 0.12 * strength));
  gradient.addColorStop(1, rgba(color, 0.38 * strength));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.lineWidth = width * 3.2;
  ctx.filter = `blur(${Math.max(1, width * 0.9)}px)`;
  ctx.stroke();
  ctx.restore();
}

/** An expanding ring used for take-off and touchdown beats. */
function drawPulse(
  ctx: CanvasRenderingContext2D,
  point: ScreenPoint,
  progress: number,
  color: string,
  unit: number
) {
  if (progress <= 0 || progress >= 1) return;
  for (const offset of [0, 0.28]) {
    const p = (progress - offset) / (1 - offset);
    if (p <= 0 || p >= 1) continue;
    const eased = 1 - Math.pow(1 - p, 3);
    ctx.save();
    ctx.strokeStyle = rgba(color, (1 - p) * 0.75);
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.arc(point.x, point.y, (10 + eased * 46) * unit, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawFlightOverlay({ ctx, project, route, timeline, spec, unit, timeMs }: FlightOverlayInput) {
  if (route.length < 2) return;
  const { appearance } = spec;
  const rp = timeline.routeProgress;
  const altitude = flightAltitude(rp);

  // Airport beats: a pulse when the aircraft leaves and when it lands.
  if (timeline.scene === "origin") {
    drawPulse(ctx, project(route[0]), timeline.sceneProgress, appearance.accentColor, unit);
  }
  if (timeline.scene === "destination") {
    drawPulse(ctx, project(route[route.length - 1]), timeline.sceneProgress, appearance.accentColor, unit);
  }

  // Trail: the last ~9% of the route behind the aircraft, strongest at cruise.
  const trailStart = Math.max(0, rp - 0.09);
  const trailPoints: ScreenPoint[] = [];
  const TRAIL_SAMPLES = 24;
  for (let i = 0; i <= TRAIL_SAMPLES; i++) {
    const p = trailStart + ((rp - trailStart) * i) / TRAIL_SAMPLES;
    trailPoints.push(project(pointAlongRoute(route, p).point));
  }
  const trailStrength = timeline.scene === "flight" ? 0.35 + altitude * 0.65 : 0;
  drawTrail(ctx, trailPoints, appearance.routeColor, appearance.routeWidth * unit, trailStrength);

  // Heading and bank come from the projected route, so the nose always
  // matches the line on screen whatever the camera is doing.
  const window = 0.016;
  const at = (p: number) => project(pointAlongRoute(route, clamp(p, 0, 1)).point);
  const position = at(rp);
  const bearing = screenBearing(at(rp - window), at(rp + window));
  const before = screenBearing(at(rp - window * 3), at(rp - window));
  const after = screenBearing(at(rp + window), at(rp + window * 3));
  const bank = clamp(angleDelta(before, after) * 1.4, -26, 26) * altitude;

  let opacity = 1;
  if (timeline.scene === "intro") opacity = smoothstep(0.35, 1, timeline.sceneProgress);
  if (timeline.scene === "outro") opacity = 1 - smoothstep(0, 0.6, timeline.sceneProgress);

  drawAircraft(ctx, {
    x: position.x,
    y: position.y,
    bearing,
    bank,
    altitude,
    opacity,
    color: appearance.vehicleColor,
    size: 34 * appearance.vehicleScale * unit,
    timeMs,
  });
}
