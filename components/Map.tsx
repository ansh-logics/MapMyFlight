"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { RenderSpecV1 } from "@/lib/render-spec";
import { getTotalDuration } from "@/lib/render-spec";
import {
  createGreatCircle,
  pointAlongRoute,
  routeGeoJson,
  smoothMercatorBearing,
} from "@/lib/route-geometry";
import { evaluateTimeline } from "@/lib/timeline";
import {
  getCinematicCameraPose,
  type OverviewCamera,
} from "@/lib/cinematic-camera";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const ROUTE_GHOST = "studio-route-ghost";
const ROUTE_ACTIVE = "studio-route-active";
const ROUTE_SOURCE = "studio-route";
const ACTIVE_SOURCE = "studio-active-route";
const POINTS_SOURCE = "studio-points";
const POINT_LABELS = "studio-point-labels";
const PLANE_SOURCE = "studio-plane";
const PLANE_LAYER = "studio-plane-layer";
const PLANE_IMAGE = "studio-plane-image";
const TERRAIN_SOURCE = "studio-terrain-dem";

type MapProps = {
  spec: RenderSpecV1 | null;
  replayTrigger?: number;
  onSequenceComplete?: () => void;
};

function planeSvg(color: string) {
  return `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".45"/>
    </filter></defs>
    <path filter="url(#s)" fill="${color}" stroke="rgba(255,255,255,.72)" stroke-width="2"
      d="M64 8c-4 0-7 3-7 7v36L17 69v9l40-9v35l-11 8v8l18-5 18 5v-8l-11-8V69l40 9v-9L71 51V15c0-4-3-7-7-7z"/>
  </svg>`;
}

function pointFeature(coordinates: [number, number], bearing = 0) {
  return {
    type: "Feature" as const,
    properties: { bearing },
    geometry: { type: "Point" as const, coordinates },
  };
}

async function waitForStyle(map: mapboxgl.Map) {
  if (map.isStyleLoaded()) return;
  await new Promise<void>((resolve) => map.once("style.load", () => resolve()));
}

async function installPlane(map: mapboxgl.Map, color: string) {
  if (map.hasImage(PLANE_IMAGE)) map.removeImage(PLANE_IMAGE);
  const svg = planeSvg(color);
  try {
    const bitmap = await createImageBitmap(new Blob([svg], { type: "image/svg+xml" }));
    map.addImage(PLANE_IMAGE, bitmap, { pixelRatio: 2 });
    return true;
  } catch {
    return false;
  }
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

    const setup = async () => {
      await waitForStyle(map);
      if (cancelled) return;
      map.resize();

      const routeData = routeGeoJson(route);
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeData });
      map.addSource(ACTIVE_SOURCE, {
        type: "geojson",
        data: routeGeoJson([route[0], route[0]]),
      });
      map.addSource(POINTS_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "origin", name: spec.route.from.name },
              geometry: { type: "Point", coordinates: route[0] },
            },
            {
              type: "Feature",
              properties: { kind: "destination", name: spec.route.to.name },
              geometry: { type: "Point", coordinates: route[route.length - 1] },
            },
          ],
        },
      });
      map.addSource(PLANE_SOURCE, {
        type: "geojson",
        data: pointFeature(route[0]),
      });
      if (!map.getSource(TERRAIN_SOURCE)) {
        map.addSource(TERRAIN_SOURCE, {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1.45 });
      map.setFog({
        color: spec.map.theme === "midnight" ? "#080d17" : "#e9e4d9",
        "high-color": spec.map.theme === "midnight" ? "#16243a" : "#d8e0e5",
        "horizon-blend": 0.18,
        "space-color": "#05070b",
        "star-intensity": spec.map.theme === "midnight" ? 0.12 : 0,
      });

      // Route ghost line (full route, low opacity)
      map.addLayer({
        id: ROUTE_GHOST,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": spec.appearance.routeColor,
          "line-opacity": 0.18,
          "line-width": spec.appearance.routeWidth,
        },
      });
      // Active route line (progress)
      map.addLayer({
        id: ROUTE_ACTIVE,
        type: "line",
        source: ACTIVE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": spec.appearance.routeColor,
          "line-width": spec.appearance.routeWidth + 1.2,
          "line-blur": 0.35,
        },
      });
      // Marker halos
      map.addLayer({
        id: "studio-point-halo",
        type: "circle",
        source: POINTS_SOURCE,
        paint: {
          "circle-radius": 10,
          "circle-color": spec.appearance.accentColor,
          "circle-opacity": 0.18,
        },
      });
      // Marker dots
      map.addLayer({
        id: "studio-points",
        type: "circle",
        source: POINTS_SOURCE,
        paint: {
          "circle-radius": 4.5,
          "circle-color": spec.appearance.accentColor,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      // Place name labels on the map
      map.addLayer({
        id: POINT_LABELS,
        type: "symbol",
        source: POINTS_SOURCE,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 14,
          "text-anchor": "top",
          "text-offset": [0, 1.2],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": spec.map.theme === "midnight" ? "#0a0f1a" : "#f5f0e8",
          "text-halo-width": 2,
        },
      });
      // Plane icon
      if (await installPlane(map, spec.appearance.vehicleColor)) {
        map.addLayer({
          id: PLANE_LAYER,
          type: "symbol",
          source: PLANE_SOURCE,
          layout: {
            "icon-image": PLANE_IMAGE,
            "icon-size": spec.appearance.vehicleScale,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
          },
        });
      }

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

      const waitForTiles = () => new Promise<void>((resolve) => {
        if (cancelled) { resolve(); return; }
        let framesCount = 0;
        const check = () => {
          if (cancelled) {
            map.off("render", check);
            resolve();
            return;
          }
          framesCount++;
          // Wait at least 2 frames for Mapbox to invalidate the viewport
          // and request new tiles before we trust `areTilesLoaded()`
          if (framesCount > 2 && map.loaded() && map.areTilesLoaded()) {
            map.off("render", check);
            resolve();
          }
        };
        map.on("render", check);
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
      const trackingZoom = Math.max(
        overviewRef.current.zoom + (portrait ? 1.15 : 1.75),
        portrait ? 3.65 : 4.2
      );
      const PREWARM_STEPS = 6;
      for (let i = 0; i <= PREWARM_STEPS; i++) {
        if (cancelled) return;
        const t = i / PREWARM_STEPS;
        const idx = Math.min(route.length - 1, Math.round(t * (route.length - 1)));
        map.jumpTo({
          center: route[idx],
          zoom: trackingZoom,
          pitch: portrait ? 48 : 54,
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

      setIsPrewarming(false);
      timeRef.current = 0;
      setPlaying(true);
    };
    void setup();
    return () => {
      cancelled = true;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      if (mapRef.current !== map) return;
      try {
        for (const id of [
          PLANE_LAYER,
          POINT_LABELS,
          "studio-points",
          "studio-point-halo",
          ROUTE_ACTIVE,
          ROUTE_GHOST,
        ]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [PLANE_SOURCE, POINTS_SOURCE, ACTIVE_SOURCE, ROUTE_SOURCE]) {
          if (map.getSource(id)) map.removeSource(id);
        }
        if (map.hasImage(PLANE_IMAGE)) map.removeImage(PLANE_IMAGE);
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
    if (!map || !spec || !playing || !overview || route.length < 2) return;

    const total = getTotalDuration(spec.timings);
    const startedAt = performance.now() - timeRef.current;

    // Keep a running bearing to smooth out micro-jitter
    let prevBearing: number | null = null;

    const tick = (now: number) => {
      const currentMs = Math.min(total, now - startedAt);
      timeRef.current = currentMs;

      // Compute the full timeline state
      const timeline = evaluateTimeline(spec, currentMs);

      // Update camera
      const camera = getCinematicCameraPose(route, timeline, overview, spec.aspectRatio);
      map.jumpTo(camera);

      // Update route progress line and plane
      const { point, index } = pointAlongRoute(route, timeline.routeProgress);
      const partial = route.slice(0, index + 1);
      partial.push(point);
      (map.getSource(ACTIVE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(
        routeGeoJson(partial)
      );

      // Compute Mercator-projected bearing so the nose matches the on-screen line
      let heading = smoothMercatorBearing(route, timeline.routeProgress);

      // Smooth bearing transitions to eliminate micro-jumps
      if (prevBearing !== null) {
        let delta = heading - prevBearing;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        // Exponential smoothing — blend 30% new bearing, 70% previous
        heading = prevBearing + delta * 0.3;
        heading = ((heading % 360) + 360) % 360;
      }
      prevBearing = heading;

      (map.getSource(PLANE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(
        pointFeature(point, heading)
      );

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
  }, [playing, spec, route]);

  const distance = spec ? Math.round(spec.route.distanceKm).toLocaleString() : "—";

  return (
    <div className="studio-preview-shell">
      <div
        ref={mapContainer}
        className="studio-map"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
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
