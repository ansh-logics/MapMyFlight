"use client";

import mapboxgl from "mapbox-gl";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type {
  CloudRenderJob,
  LocalRenderOptions,
  RenderProgress,
  RenderProvider,
  RenderResult,
  RenderSpecV1,
} from "./render-spec";
import { getOutputSize, getTotalDuration } from "./render-spec";
import {
  bearingBetween,
  createGreatCircle,
  pointAlongRoute,
} from "./route-geometry";
import { evaluateTimeline } from "./timeline";
import {
  getCinematicCameraPose,
  type OverviewCamera,
} from "./cinematic-camera";

const MAP_LOAD_TIMEOUT_MS = 20_000;

function emit(
  callback: LocalRenderOptions["onProgress"],
  progress: RenderProgress
) {
  callback?.(progress);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Render cancelled", "AbortError");
}

function waitForMap(map: mapboxgl.Map, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The map took too long to load. Please try again."));
    }, MAP_LOAD_TIMEOUT_MS);
    const onIdle = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Render cancelled", "AbortError"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      map.off("idle", onIdle);
      signal?.removeEventListener("abort", onAbort);
    };
    map.once("idle", onIdle);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bearing: number,
  color: string,
  scale: number
) {
  const size = 36 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((bearing * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = size * 0.42;
  ctx.shadowOffsetY = size * 0.16;
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,.78)";
  ctx.lineWidth = Math.max(1.5, size * 0.045);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.22, -size * 0.82, size * 0.23, -size * 0.2, size * 0.2, 0);
  ctx.lineTo(size * 0.92, size * 0.38);
  ctx.lineTo(size * 0.92, size * 0.58);
  ctx.lineTo(size * 0.2, size * 0.38);
  ctx.lineTo(size * 0.15, size * 0.8);
  ctx.lineTo(size * 0.38, size);
  ctx.lineTo(size * 0.38, size * 1.12);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.38, size * 1.12);
  ctx.lineTo(-size * 0.38, size);
  ctx.lineTo(-size * 0.15, size * 0.8);
  ctx.lineTo(-size * 0.2, size * 0.38);
  ctx.lineTo(-size * 0.92, size * 0.58);
  ctx.lineTo(-size * 0.92, size * 0.38);
  ctx.lineTo(-size * 0.2, 0);
  ctx.bezierCurveTo(-size * 0.23, -size * 0.2, -size * 0.22, -size * 0.82, 0, -size);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  scale: number
) {
  ctx.save();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(x, y, 18 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  align: "left" | "right"
) {
  ctx.save();
  ctx.font = `600 ${18 * scale}px "Geist", "Helvetica Neue", sans-serif`;
  const width = ctx.measureText(text).width + 32 * scale;
  const height = 40 * scale;
  const left = align === "left" ? x + 16 * scale : x - width - 16 * scale;
  const top = y - height / 2;
  ctx.fillStyle = "rgba(8, 13, 24, .82)";
  ctx.strokeStyle = "rgba(255, 255, 255, .18)";
  ctx.lineWidth = Math.max(1, scale);
  roundedRect(ctx, left, top, width, height, 10 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, left + 16 * scale, y + scale);
  ctx.restore();
}

type FrameContext = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: mapboxgl.Map;
  route: [number, number][];
  spec: RenderSpecV1;
  width: number;
  height: number;
  overview: OverviewCamera;
};

function renderCameraFrame(
  frame: FrameContext,
  timeMs: number,
  signal?: AbortSignal
) {
  const timeline = evaluateTimeline(frame.spec, timeMs);
  const camera = getCinematicCameraPose(
    frame.route,
    timeline,
    frame.overview,
    frame.spec.aspectRatio
  );
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(), 750);
    const onAbort = () => finish(new DOMException("Render cancelled", "AbortError"));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      frame.map.off("render", onRender);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onRender = () => finish();
    frame.map.once("render", onRender);
    signal?.addEventListener("abort", onAbort, { once: true });
    frame.map.jumpTo(camera);
    frame.map.triggerRepaint();
  });
}

function drawFrame(frame: FrameContext, timeMs: number) {
  const { ctx, canvas, map, route, spec, width, height } = frame;
  const timeline = evaluateTimeline(spec, timeMs);
  const portrait = spec.aspectRatio === "9:16";
  const unit = Math.min(width / 1920, height / 1080);
  const safeX = portrait ? width * 0.075 : width * 0.065;
  const mapCanvas = map.getCanvas();

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(mapCanvas, 0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width / 2,
    height * 0.45,
    Math.min(width, height) * 0.15,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72
  );
  vignette.addColorStop(0, "rgba(3,7,15,0)");
  vignette.addColorStop(0.72, "rgba(3,7,15,.18)");
  vignette.addColorStop(1, "rgba(3,7,15,.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const projected = route.map((point) => map.project(point));
  const active = pointAlongRoute(route, timeline.routeProgress);
  const visiblePoints = projected.slice(0, active.index + 1);
  const activeScreen = map.project(active.point);
  visiblePoints.push(activeScreen);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = spec.appearance.routeColor;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = spec.appearance.routeWidth * unit;
  ctx.beginPath();
  projected.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowColor = spec.appearance.routeColor;
  ctx.shadowBlur = 12 * unit;
  ctx.lineWidth = (spec.appearance.routeWidth + 1.5) * unit;
  ctx.beginPath();
  visiblePoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();

  const origin = projected[0];
  const destination = projected[projected.length - 1];
  drawMarker(ctx, origin.x, origin.y, spec.appearance.accentColor, unit);
  drawMarker(ctx, destination.x, destination.y, spec.appearance.accentColor, unit);
  drawLabel(ctx, spec.route.from.name, origin.x, origin.y - 34 * unit, unit, "left");
  drawLabel(ctx, spec.route.to.name, destination.x, destination.y - 34 * unit, unit, "right");

  if (timeline.scene !== "intro" && timeline.scene !== "outro") {
    const next = route[Math.min(active.index + 1, route.length - 1)];
    drawPlane(
      ctx,
      activeScreen.x,
      activeScreen.y,
      bearingBetween(route[active.index], next),
      spec.appearance.vehicleColor,
      spec.appearance.vehicleScale * unit
    );
  }

  if (timeline.scene === "intro" || timeline.scene === "outro") {
    ctx.fillStyle = `rgba(4, 8, 16, ${0.72 + timeline.overlayOpacity * 0.15})`;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.fillStyle = spec.appearance.accentColor;
    ctx.font = `600 ${18 * unit}px "Geist", sans-serif`;
    ctx.fillText(
      timeline.scene === "intro" ? "A JOURNEY FROM" : spec.story.brand.toUpperCase(),
      width / 2,
      height * 0.38
    );
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${portrait ? 62 * unit : 68 * unit}px "Geist", sans-serif`;
    const title =
      timeline.scene === "intro"
        ? `${spec.route.from.name}  —  ${spec.route.to.name}`
        : spec.story.outroTitle;
    ctx.fillText(title, width / 2, height * 0.48);
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.font = `400 ${22 * unit}px "Geist", sans-serif`;
    ctx.fillText(
      timeline.scene === "intro"
        ? spec.story.subtitle
        : `${spec.route.from.name}  →  ${spec.route.to.name}`,
      width / 2,
      height * 0.55
    );
  } else {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,.64)";
    ctx.font = `500 ${16 * unit}px "Geist", sans-serif`;
    ctx.fillText(
      timeline.scene === "destination" ? "ARRIVED IN" : "JOURNEY TO",
      safeX,
      portrait ? height * 0.11 : height * 0.12
    );
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${portrait ? 48 * unit : 44 * unit}px "Geist", sans-serif`;
    ctx.fillText(
      timeline.scene === "origin" ? spec.route.from.name : spec.route.to.name,
      safeX,
      portrait ? height * 0.15 : height * 0.17
    );

    const factY = portrait ? height * 0.86 : height * 0.84;
    ctx.font = `500 ${15 * unit}px "Geist", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,.58)";
    ctx.fillText("DISTANCE", safeX, factY);
    ctx.fillText("FLIGHT", safeX + 190 * unit, factY);
    ctx.font = `600 ${22 * unit}px "Geist", sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${Math.round(spec.route.distanceKm).toLocaleString()} km`, safeX, factY + 34 * unit);
    ctx.fillText(`${Math.round(spec.timings.flightMs / 1000)} sec`, safeX + 190 * unit, factY + 34 * unit);
  }

  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.textAlign = "left";
  ctx.font = `600 ${12 * unit}px "Geist", sans-serif`;
  ctx.fillText("mapbox", 28 * unit, height - 28 * unit);
  ctx.font = `400 ${10 * unit}px "Geist", sans-serif`;
  ctx.fillText("© Mapbox © OpenStreetMap", 92 * unit, height - 28 * unit);

  return canvas;
}

async function createRenderMap(
  spec: RenderSpecV1,
  width: number,
  height: number,
  signal?: AbortSignal
) {
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
  });
  document.body.appendChild(container);
  const map = new mapboxgl.Map({
    container,
    style: spec.map.styleUrl,
    center: spec.route.from.coordinates,
    zoom: 2,
    projection: "mercator",
    antialias: true,
    attributionControl: false,
    interactive: false,
    preserveDrawingBuffer: true,
  });
  await waitForMap(map, signal);
  const route = createGreatCircle(spec.route.from.coordinates, spec.route.to.coordinates, 220);
  const bounds = route.reduce(
    (result, point) => result.extend(point),
    new mapboxgl.LngLatBounds(route[0], route[0])
  );
  map.fitBounds(bounds, {
    padding:
      spec.aspectRatio === "9:16"
        ? { top: height * 0.25, right: width * 0.08, bottom: height * 0.26, left: width * 0.08 }
        : { top: height * 0.18, right: width * 0.08, bottom: height * 0.18, left: width * 0.08 },
    duration: 0,
  });
  map.resize();
  if (!map.getSource("studio-export-terrain")) {
    map.addSource("studio-export-terrain", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
  }
  map.setTerrain({ source: "studio-export-terrain", exaggeration: 1.45 });
  map.setFog({
    color: spec.map.theme === "midnight" ? "#080d17" : "#e9e4d9",
    "high-color": spec.map.theme === "midnight" ? "#16243a" : "#d8e0e5",
    "horizon-blend": 0.18,
    "space-color": "#05070b",
    "star-intensity": spec.map.theme === "midnight" ? 0.12 : 0,
  });
  await waitForMap(map, signal);
  const center = map.getCenter();
  return {
    map,
    container,
    route,
    overview: { center: [center.lng, center.lat] as [number, number], zoom: map.getZoom() },
  };
}

async function resolveAvcConfig(width: number, height: number, frameRate: number) {
  if (!("VideoEncoder" in window)) return null;
  const bitrate = width >= 1900 ? 18_000_000 : 12_000_000;
  for (const codec of ["avc1.640028", "avc1.4d4028", "avc1.42001f"]) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      framerate: frameRate,
      bitrate,
      hardwareAcceleration: "prefer-hardware",
    }).catch(() => null);
    if (support?.supported) {
      return {
        ...support.config,
        codec,
        width,
        height,
        framerate: frameRate,
        bitrate,
      } satisfies VideoEncoderConfig;
    }
  }
  return null;
}

async function encodeMp4(
  frameContext: FrameContext,
  options: LocalRenderOptions
): Promise<Blob> {
  const { spec, width, height } = frameContext;
  const config = await resolveAvcConfig(width, height, spec.frameRate);
  if (!config) throw new Error("H.264 WebCodecs export is unavailable in this browser.");
  const totalMs = getTotalDuration(spec.timings);
  const totalFrames = Math.ceil((totalMs / 1000) * spec.frameRate);
  const frameDurationUs = Math.round(1_000_000 / spec.frameRate);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
    video: { codec: "avc", width, height, frameRate: spec.frameRate },
  });
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);

  try {
    for (let index = 0; index < totalFrames; index += 1) {
      throwIfAborted(options.signal);
      const timeMs = (index / spec.frameRate) * 1000;
      const cameraStride = spec.frameRate === 60 ? 2 : 1;
      if (index % cameraStride === 0) {
        await renderCameraFrame(frameContext, timeMs, options.signal);
      }
      drawFrame(frameContext, timeMs);
      const frame = new VideoFrame(frameContext.canvas, {
        timestamp: index * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: index % (spec.frameRate * 2) === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await encoder.flush();
      if (index % 3 === 0 || index === totalFrames - 1) {
        emit(options.onProgress, {
          phase: "encoding",
          progress: index / totalFrames,
          message: `Rendering frame ${index + 1} of ${totalFrames}`,
          frame: index + 1,
          totalFrames,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    emit(options.onProgress, { phase: "muxing", progress: 0.98, message: "Finalizing MP4…" });
    muxer.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

async function encodeWebm(
  frameContext: FrameContext,
  options: LocalRenderOptions
): Promise<Blob> {
  const { canvas, spec } = frameContext;
  const stream = canvas.captureStream(spec.frameRate);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm;codecs=vp8";
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 14_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  const totalMs = getTotalDuration(spec.timings);
  const totalFrames = Math.ceil((totalMs / 1000) * spec.frameRate);
  recorder.start(250);
  try {
    for (let index = 0; index < totalFrames; index += 1) {
      throwIfAborted(options.signal);
      const timeMs = (index / spec.frameRate) * 1000;
      const cameraStride = spec.frameRate === 60 ? 2 : 1;
      if (index % cameraStride === 0) {
        await renderCameraFrame(frameContext, timeMs, options.signal);
      }
      drawFrame(frameContext, timeMs);
      emit(options.onProgress, {
        phase: "encoding",
        progress: index / totalFrames,
        message: `Recording frame ${index + 1} of ${totalFrames}`,
        frame: index + 1,
        totalFrames,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 1000 / spec.frameRate));
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
  await stopped;
  return new Blob(chunks, { type: mimeType });
}

export class BrowserRenderProvider implements RenderProvider {
  async renderLocal(
    spec: RenderSpecV1,
    options: LocalRenderOptions
  ): Promise<RenderResult> {
    if (spec.quality !== "1080p") {
      throw new Error("4K rendering requires a configured cloud render provider.");
    }
    throwIfAborted(options.signal);
    emit(options.onProgress, { phase: "preparing", progress: 0.01, message: "Preparing studio…" });
    await document.fonts.ready;
    const { width, height } = getOutputSize(spec.aspectRatio, spec.quality);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create the export canvas.");

    emit(options.onProgress, {
      phase: "loading-assets",
      progress: 0.03,
      message: "Loading high-resolution map…",
    });
    const renderMap = await createRenderMap(spec, width, height, options.signal);
    try {
      const frameContext: FrameContext = {
        canvas,
        ctx,
        map: renderMap.map,
        route: renderMap.route,
        spec,
        width,
        height,
        overview: renderMap.overview,
      };
      const blob =
        options.format === "mp4"
          ? await encodeMp4(frameContext, options)
          : await encodeWebm(frameContext, options);
      throwIfAborted(options.signal);
      emit(options.onProgress, { phase: "completed", progress: 1, message: "Video ready" });
      return {
        blob,
        format: options.format,
        width,
        height,
        durationMs: getTotalDuration(spec.timings),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        emit(options.onProgress, { phase: "cancelled", progress: 0, message: "Export cancelled" });
      } else {
        emit(options.onProgress, { phase: "failed", progress: 0, message: "Export failed" });
      }
      throw error;
    } finally {
      renderMap.map.remove();
      renderMap.container.remove();
    }
  }

  async createCloudRender(spec: RenderSpecV1): Promise<{ jobId: string }> {
    void spec;
    throw new Error("Cloud rendering is not configured yet.");
  }

  async getCloudRender(jobId: string): Promise<CloudRenderJob> {
    void jobId;
    throw new Error("Cloud rendering is not configured yet.");
  }
}

export function downloadRender(result: RenderResult, from: string, to: string) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  const slug = `${from}-to-${to}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  anchor.href = url;
  anchor.download = `${slug || "travel-story"}-${result.width}x${result.height}.${result.format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
