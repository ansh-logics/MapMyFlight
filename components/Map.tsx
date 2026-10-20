"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { RenderSpecV1 } from "@/lib/render-spec";
import { getTotalDuration } from "@/lib/render-spec";
import { createGreatCircle } from "@/lib/route-geometry";
import { evaluateTimeline } from "@/lib/timeline";
import {
  getCinematicCameraPose,
  getTrackingPitch,
  getTrackingZoom,
  type OverviewCamera,
} from "@/lib/cinematic-camera";
import { drawFlightOverlay } from "@/lib/flight-graphics";
import { installFlightScene, removeFlightScene, setRouteProgress } from "@/lib/flight-scene";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";


type MapProps = {
  spec: RenderSpecV1 | null;
  replayTrigger?: number;
  onSequenceComplete?: () => void;
};

async function waitForStyle(map: mapboxgl.Map) {
  if (map.isStyleLoaded()) return;
  await new Promise<void>((resolve) => map.once("style.load", () => resolve()));
}

export default function Map({ spec, replayTrigger = 0, onSequenceComplete }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const appliedStyleRef = useRef("mapbox://styles/mapbox/dark-v11");
  const overviewRef = useRef<OverviewCamera | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const onCompleteRef = useRef(onSequenceComplete);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawOverlayRef = useRef<((timeMs: number) => void) | null>(null);
  const [readyVersion, setReadyVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isPrewarming, setIsPrewarming] = useState(false);
  const styleUrl = spec?.map.styleUrl;
  const route = useMemo(
    () =>
      spec
        ? createGreatCircle(spec.route.from.coordinates, spec.route.to.coordinates)
        : [],
    [spec]
  );

  useEffect(() => {
    onCompleteRef.current = onSequenceComplete;
  }, [onSequenceComplete]);

  // Initialize the map once
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [77.209, 28.6139],
      zoom: 2.5,
      projection: "mercator",
      antialias: true,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;
    map.once("load", () => setReadyVersion((value) => value + 1));
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(mapContainer.current);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Handle style changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleUrl) return;
    if (appliedStyleRef.current === styleUrl) return;
    appliedStyleRef.current = styleUrl;
    map.setStyle(styleUrl);
    map.once("style.load", () => setReadyVersion((value) => value + 1));
  }, [styleUrl]);

  // Setup sources, layers, and pre-warm the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !spec || route.length < 2) return;
    let cancelled = false;
    const overlay = overlayRef.current;

    const setup = async () => {
      await waitForStyle(map);
      if (cancelled) return;
      map.resize();

      installFlightScene(map, spec, route);

      const bounds = route.reduce(
        (result, point) => result.extend(point),
        new mapboxgl.LngLatBounds(route[0], route[0])
      );
      const portrait = spec.aspectRatio === "9:16";
      map.fitBounds(bounds, {
        padding: portrait
          ? { top: 220, right: 55, bottom: 250, left: 55 }
          : { top: 120, right: 100, bottom: 130, left: 100 },
        duration: 0,
      });
      const center = map.getCenter();
      map.setCenter([center.lng, center.lat]);
      overviewRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom() - (portrait ? 0.3 : 0),
      };

      // Best effort: pre-warming only fills the tile cache, so it must never
      // block the preview. Resolves on Mapbox's "idle" (everything loaded and
      // drawn), a settled render, or after a few seconds regardless.
      const waitForTiles = () => new Promise<void>((resolve) => {
        if (cancelled) { resolve(); return; }
        let framesCount = 0;
        const done = () => {
          window.clearTimeout(timeout);
          map.off("render", check);
          map.off("idle", done);
          resolve();
        };
        const check = () => {
          framesCount++;
          // Wait at least 2 frames for Mapbox to invalidate the viewport
          // and request new tiles before we trust `areTilesLoaded()`
          if (cancelled || (framesCount > 2 && map.loaded() && map.areTilesLoaded())) done();
        };
        const timeout = window.setTimeout(done, 5000);
        map.on("render", check);
        map.once("idle", done);
        // Force a repaint to start the frame loop
        map.triggerRepaint();
      });

      // Pre-warm: wait for overview tiles first
      setIsPrewarming(true);
      await waitForTiles();
      if (cancelled) return;

      // Walk the camera along the route at tracking zoom so all tiles are
      // cached before the animation starts. Prevents blank dark patches
      // when the camera zooms in during playback.
      const trackingZoom = getTrackingZoom(overviewRef.current, spec.aspectRatio) + 0.25;
      const PREWARM_STEPS = 6;
      for (let i = 0; i <= PREWARM_STEPS; i++) {
        if (cancelled) return;
        const t = i / PREWARM_STEPS;
        const idx = Math.min(route.length - 1, Math.round(t * (route.length - 1)));
        map.jumpTo({
          center: route[idx],
          zoom: trackingZoom,
          pitch: getTrackingPitch(spec.aspectRatio),
          bearing: 0,
        });
        await waitForTiles();
      }
      if (cancelled) return;

      // Return to overview for the animation start
      map.jumpTo({
        center: overviewRef.current.center,
        zoom: overviewRef.current.zoom,
        pitch: 0,
        bearing: 0,
      });
      await waitForTiles();
      if (cancelled) return;

      // Overlay drawing for the aircraft, trail and pulses — the same code
      // the export uses, so the preview matches the rendered film.
      drawOverlayRef.current = (timeMs: number) => {
        const canvas = overlayRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawFlightOverlay({
          ctx,
          project: (point) => map.project(point),
          route,
          timeline: evaluateTimeline(spec, timeMs),
          spec,
          unit: Math.min(width, height) / 1080,
          timeMs,
        });
      };

      setIsPrewarming(false);
      timeRef.current = 0;
      setPlaying(true);
    };
    void setup();
    return () => {
      cancelled = true;
      drawOverlayRef.current = null;
      overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      if (mapRef.current !== map) return;
      try {
        removeFlightScene(map);
      } catch {
        // The owning map effect may already have disposed the style.
      }
    };
  }, [spec, route, readyVersion]);

  // Replay trigger
  useEffect(() => {
    if (!spec) return;
    const resetFrame = requestAnimationFrame(() => {
      timeRef.current = 0;
      setPlaying(true);
    });
    return () => cancelAnimationFrame(resetFrame);
  }, [replayTrigger, spec]);

  // Single unified animation loop — updates the map directly in the RAF
  // callback. No React state is set per-frame, which eliminates the jitter
  // caused by the React render → effect → map update round-trip.
  useEffect(() => {
    const map = mapRef.current;
    const overview = overviewRef.current;
    // Wait for pre-warming: it sets the overview camera the move starts from.
    // Depending on isPrewarming also restarts playback when pre-warming ends,
    // even if a replay already flipped `playing` to true in the meantime.
    if (!map || !spec || !playing || isPrewarming || !overview || route.length < 2) return;

    const total = getTotalDuration(spec.timings);
    const startedAt = performance.now() - timeRef.current;

    const tick = (now: number) => {
      const currentMs = Math.min(total, now - startedAt);
      timeRef.current = currentMs;

      // Compute the full timeline state
      const timeline = evaluateTimeline(spec, currentMs);

      // Update camera
      const camera = getCinematicCameraPose(route, timeline, overview, spec.aspectRatio);
      map.jumpTo(camera);

      setRouteProgress(map, route, timeline.routeProgress);

      drawOverlayRef.current?.(currentMs);

      // Update progress bar directly via DOM ref (no React re-render)
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${(timeline.totalProgress ?? 0) * 100}%`;
      }

      if (currentMs < total) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setPlaying(false);
        onCompleteRef.current?.();
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, isPrewarming, spec, route]);

  // Keep the overlay pinned to the map when it repaints outside playback
  // (resizes, the user panning after the film ends).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || playing) return;
    const redraw = () => drawOverlayRef.current?.(timeRef.current);
    map.on("render", redraw);
    redraw();
    return () => {
      map.off("render", redraw);
    };
  }, [playing, readyVersion, spec]);

  const distance = spec ? Math.round(spec.route.distanceKm).toLocaleString() : "—";

  return (
    <div className="studio-preview-shell">
      <div
        ref={mapContainer}
        className="studio-map"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <canvas ref={overlayRef} className="studio-flight-overlay" aria-hidden="true" />
      <div className="studio-map-vignette" />

      {isPrewarming && spec && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          background: "rgba(4, 8, 16, 0.85)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.9)",
          flexDirection: "column",
          gap: "12px",
          fontFamily: '"Geist", sans-serif'
        }}>
          <div style={{
            width: "24px", height: "24px",
            border: "2px solid rgba(255,255,255,0.2)",
            borderTopColor: "#e0b36a",
            borderRadius: "50%",
            animation: "studio-spin 1s linear infinite"
          }} />
          <span style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "0.02em" }}>
            Preparing environment...
          </span>
          <style>{`
            @keyframes studio-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {!spec && (
        <div className="studio-empty-state">
          <span className="studio-eyebrow">Your story starts here</span>
          <h2>Your journey, in motion.</h2>
          <p>A cinematic route, crafted in seconds.</p>
        </div>
      )}

      {spec && (
        <div className="studio-distance-badge">
          {distance} km
        </div>
      )}

      <div className="studio-attribution">
        <span className="studio-mapbox-wordmark">mapbox</span>
        <span>© Mapbox © OpenStreetMap</span>
      </div>
      {spec && (
        <div className="studio-timeline">
          <div ref={progressBarRef} />
        </div>
      )}
    </div>
  );
}
