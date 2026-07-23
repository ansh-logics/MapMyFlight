"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { RenderSpecV1 } from "@/lib/render-spec";
import { getTotalDuration } from "@/lib/render-spec";
import {
  bearingBetween,
  createGreatCircle,
  pointAlongRoute,
  routeGeoJson,
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
  const [readyVersion, setReadyVersion] = useState(0);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const styleUrl = spec?.map.styleUrl;
  const route = useMemo(
    () =>
      spec
        ? createGreatCircle(spec.route.from.coordinates, spec.route.to.coordinates)
        : [],
    [spec]
  );
  const timeline = spec ? evaluateTimeline(spec, timeMs) : null;

  useEffect(() => {
    onCompleteRef.current = onSequenceComplete;
  }, [onSequenceComplete]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleUrl) return;
    if (appliedStyleRef.current === styleUrl) return;
    appliedStyleRef.current = styleUrl;
    map.setStyle(styleUrl);
    map.once("style.load", () => setReadyVersion((value) => value + 1));
  }, [styleUrl]);

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
            { ...pointFeature(route[0]), properties: { kind: "origin" } },
            { ...pointFeature(route[route.length - 1]), properties: { kind: "destination" } },
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
        zoom: map.getZoom(),
      };
      timeRef.current = 0;
      setTimeMs(0);
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

  useEffect(() => {
    if (!spec) return;
    const resetFrame = requestAnimationFrame(() => {
      timeRef.current = 0;
      setTimeMs(0);
      setPlaying(true);
    });
    return () => cancelAnimationFrame(resetFrame);
  }, [replayTrigger, spec]);

  useEffect(() => {
    if (!spec || !playing) return;
    const total = getTotalDuration(spec.timings);
    const startedAt = performance.now() - timeRef.current;
    const tick = (now: number) => {
      const next = Math.min(total, now - startedAt);
      timeRef.current = next;
      setTimeMs(next);
      if (next < total) {
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
  }, [playing, spec]);

  useEffect(() => {
    const map = mapRef.current;
    const overview = overviewRef.current;
    if (!map || !spec || !timeline || !overview || route.length < 2) return;
    const camera = getCinematicCameraPose(route, timeline, overview, spec.aspectRatio);
    map.jumpTo(camera);
    const { point, index } = pointAlongRoute(route, timeline.routeProgress);
    const partial = route.slice(0, index + 1);
    partial.push(point);
    (map.getSource(ACTIVE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(
      routeGeoJson(partial)
    );
    (map.getSource(PLANE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(
      pointFeature(point, bearingBetween(route[index], route[Math.min(index + 1, route.length - 1)]))
    );
  }, [route, spec, timeline]);

  const from = spec?.route.from.name ?? "Your origin";
  const to = spec?.route.to.name ?? "Your destination";
  const distance = spec ? Math.round(spec.route.distanceKm).toLocaleString() : "—";

  return (
    <div className="studio-preview-shell">
      <div
        ref={mapContainer}
        className="studio-map"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div className="studio-map-vignette" />

      {!spec && (
        <div className="studio-empty-state">
          <span className="studio-eyebrow">Your story starts here</span>
          <h2>Your journey, in motion.</h2>
          <p>A cinematic route, crafted in seconds.</p>
        </div>
      )}

      {spec && timeline?.scene === "intro" && (
        <div className="studio-scene-card studio-scene-center">
          <span className="studio-eyebrow">A journey from</span>
          <h2>{from}</h2>
          <div className="studio-title-rule" />
          <h2>{to}</h2>
          <p>{spec.story.subtitle}</p>
        </div>
      )}

      {spec && timeline && ["origin", "flight", "destination"].includes(timeline.scene) && (
        <>
          <div className="studio-route-caption">
            <span>{timeline.scene === "destination" ? "Arrived in" : "Journey to"}</span>
            <strong>{timeline.scene === "origin" ? from : to}</strong>
          </div>
          <div className="studio-journey-facts">
            <div><span>Distance</span><strong>{distance} km</strong></div>
            <div><span>Flight</span><strong>{Math.round(spec.timings.flightMs / 1000)} sec</strong></div>
          </div>
        </>
      )}

      {spec && timeline?.scene === "outro" && (
        <div className="studio-scene-card studio-scene-center">
          <span className="studio-eyebrow">{spec.story.brand}</span>
          <h2>{spec.story.outroTitle}</h2>
          <p>{from} <span className="studio-arrow">→</span> {to}</p>
        </div>
      )}

      <div className="studio-attribution">
        <span className="studio-mapbox-wordmark">mapbox</span>
        <span>© Mapbox © OpenStreetMap</span>
      </div>
      {spec && (
        <div className="studio-timeline">
          <div style={{ width: `${(timeline?.totalProgress ?? 0) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
