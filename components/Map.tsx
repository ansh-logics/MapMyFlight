"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from "@turf/turf";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const DEFAULT_CENTER: [number, number] = [77.209, 28.6139];
const DEFAULT_ZOOM = 3;
const SOURCE_HOLD_MS = 2000;
const FLIGHT_DURATION_MS = 6000;
const ZOOM_OUT_DURATION_MS = 2000;
const ZOOM_IN_LEVEL = 11;
const TRACKING_ZOOM = 5.5;
const TRACKING_PITCH = 55;
const TRACKING_BEARING = -20;
const PERFORMANCE_TRACKING_PITCH = 35;
const PERFORMANCE_TRACKING_BEARING = -10;
const OUTRO_PITCH = 0;
const OUTRO_BEARING = 0;
const DEFAULT_ANIMATION_FPS = 30;
const CAMERA_UPDATE_INTERVAL_MS = 50;

const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_ID = "route";
const PLANE_SOURCE_ID = "plane-position";
const PLANE_LAYER_ID = "plane";
const PLANE_CORE_LAYER_ID = "plane-core";
const TERRAIN_SOURCE_ID = "mapbox-dem";
const SKY_LAYER_ID = "sky";

const PLANE_ICON_ID = "plane-icon";
const PLANE_ICON_SCALE = 0.8;
const MAX_ICON_PIXEL_RATIO = 2;
const ROUTE_POINTS = 120;

const DEFAULT_PLANE_COLOR = "#22C55E";
const PLANE_SVG_TEMPLATE = (color: string) => `<svg width="64" height="64" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <g fill="${color}">
    <path d="M256 0c-10 0-18 8-18 18v160L64 256v36l174-36v160l-46 32v32l64-18 64 18v-32l-46-32V256l174 36v-36L274 178V18c0-10-8-18-18-18z"/>
  </g>
</svg>`;

type MapProps = {
  path?: [number, number][] | null;
  replayTrigger?: number;
  onMapReady?: (map: mapboxgl.Map) => void;
  onSequenceComplete?: () => void;
  planeColor?: string;
  planeScale?: number;
  routeColor?: string;
  routeWidth?: number;
  arcHeightScale?: number;
  flightDurationMs?: number;
  mapStyle?: string;
  performanceMode?: boolean;
  fixedFps?: number | null;
};

function lerp(start: [number, number], end: [number, number], t: number): [number, number] {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function bearingDeg(start: [number, number], end: [number, number]): number {
  const [lng1, lat1] = start;
  const [lng2, lat2] = end;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function adjustHexColor(hex: string, amount: number): string | null {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const num = parseInt(normalized, 16);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function fallbackRadius(scale: number): number {
  const base = 7;
  const factor = Math.max(0.6, scale / PLANE_ICON_SCALE);
  return Math.min(22, Math.max(5, base * factor));
}

function buildLiftedRoute(coords: [number, number][], heightScale: number): [number, number][] {
  if (coords.length < 2) return coords;
  const distanceKm = turf.distance(
    turf.point(coords[0]),
    turf.point(coords[coords.length - 1]),
    { units: "kilometers" }
  );
  const maxHeightKm = Math.min(800, Math.max(40, distanceKm * heightScale));
  const lastIndex = coords.length - 1;

  return coords.map((coord, idx) => {
    const t = idx / lastIndex;
    const heightKm = Math.sin(Math.PI * t) * maxHeightKm;
    if (heightKm <= 0.0001) return coord;
    const prev = coords[Math.max(idx - 1, 0)];
    const next = coords[Math.min(idx + 1, lastIndex)];
    const tangent = turf.bearing(turf.point(prev), turf.point(next));
    const shifted = turf.destination(turf.point(coord), heightKm, tangent + 90, {
      units: "kilometers",
    });
    return shifted.geometry.coordinates as [number, number];
  });
}

function normalizeGreatCircleCoordinates(
  geometry: unknown,
  fallbackStart: [number, number],
  fallbackEnd: [number, number]
): [number, number][] {
  if (!geometry || typeof geometry !== "object") return [fallbackStart, fallbackEnd];
  const parsed = geometry as { type?: string; coordinates?: unknown };

  if (parsed.type === "LineString" && Array.isArray(parsed.coordinates)) {
    const line = parsed.coordinates.filter(
      (coord): coord is [number, number] =>
        Array.isArray(coord) &&
        coord.length >= 2 &&
        Number.isFinite(coord[0]) &&
        Number.isFinite(coord[1])
    );
    return line.length >= 2 ? line : [fallbackStart, fallbackEnd];
  }

  if (parsed.type === "MultiLineString" && Array.isArray(parsed.coordinates)) {
    const lines = parsed.coordinates
      .filter(Array.isArray)
      .map((line) =>
        line.filter(
          (coord): coord is [number, number] =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            Number.isFinite(coord[0]) &&
            Number.isFinite(coord[1])
        )
      )
      .filter((line) => line.length >= 2);
    if (!lines.length) return [fallbackStart, fallbackEnd];
    return lines.reduce((best, current) => (current.length > best.length ? current : best));
  }

  return [fallbackStart, fallbackEnd];
}

function lineFeature(coords: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: coords,
    },
  };
}

function pointFeature(coords: [number, number], bearing: number) {
  return {
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: coords,
    },
    properties: {
      bearing,
    },
  };
}

function removeLayerIfExists(map: mapboxgl.Map, id: string) {
  if (map.getLayer(id)) map.removeLayer(id);
}

function removeSourceIfExists(map: mapboxgl.Map, id: string) {
  if (map.getSource(id)) map.removeSource(id);
}

async function waitForStyleLoaded(map: mapboxgl.Map): Promise<void> {
  if (map.isStyleLoaded()) return;
  await new Promise<void>((resolve) => {
    const onStyleLoad = () => {
      map.off("style.load", onStyleLoad);
      resolve();
    };
    map.on("style.load", onStyleLoad);
  });
}

async function ensurePlaneImage(map: mapboxgl.Map, color: string): Promise<boolean> {
  const svg = PLANE_SVG_TEMPLATE(color);
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  if (map.hasImage(PLANE_ICON_ID)) {
    map.removeImage(PLANE_ICON_ID);
  }

  const addImage = (image: ImageBitmap | HTMLImageElement | ImageData) => {
    if (map.hasImage(PLANE_ICON_ID)) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_ICON_PIXEL_RATIO);
    map.addImage(PLANE_ICON_ID, image, { pixelRatio });
  };

  try {
    if ("createImageBitmap" in window) {
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const bitmap = await createImageBitmap(blob);
      addImage(bitmap);
      return true;
    }
  } catch {
    // fallback below
  }

  const loaded = await new Promise<boolean>((resolve) => {
    map.loadImage(uri, (err, image) => {
      if (!err && image) {
        addImage(image);
        resolve(true);
        return;
      }
      const img = new Image();
      img.onload = () => {
        addImage(img);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = uri;
    });
  });

  return loaded && map.hasImage(PLANE_ICON_ID);
}

export default function Map({
  path,
  replayTrigger = 0,
  onMapReady,
  onSequenceComplete,
  planeColor = DEFAULT_PLANE_COLOR,
  planeScale = PLANE_ICON_SCALE,
  routeColor = "#3b82f6",
  routeWidth = 3,
  arcHeightScale = 0.06,
  flightDurationMs = FLIGHT_DURATION_MS,
  mapStyle = "mapbox://styles/mapbox/light-v11",
  performanceMode = true,
  fixedFps = null,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const appliedStyleRef = useRef(mapStyle);
  const animationFrameRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const onSequenceCompleteRef = useRef(onSequenceComplete);

  useEffect(() => {
    onSequenceCompleteRef.current = onSequenceComplete;
  }, [onSequenceComplete]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: appliedStyleRef.current,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      antialias: true,
    });

    mapRef.current = map;
    onMapReady?.(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onMapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (appliedStyleRef.current === mapStyle) return;

    appliedStyleRef.current = mapStyle;
    cancelledRef.current = true;
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (holdTimeoutRef.current != null) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }

    if (!map.loaded()) {
      map.once("load", () => map.setStyle(mapStyle));
      return;
    }
    map.setStyle(mapStyle);
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    cancelledRef.current = false;

    const cleanupSequence = () => {
      cancelledRef.current = true;
      map.stop();
      if (holdTimeoutRef.current != null) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    const run = async () => {
      cleanupSequence();
      cancelledRef.current = false;

      await waitForStyleLoaded(map);
      if (cancelledRef.current) return;

      if (!path || path.length < 2) {
        removeLayerIfExists(map, PLANE_LAYER_ID);
        removeLayerIfExists(map, PLANE_CORE_LAYER_ID);
        removeLayerIfExists(map, ROUTE_LAYER_ID);
        removeLayerIfExists(map, SKY_LAYER_ID);
        removeSourceIfExists(map, PLANE_SOURCE_ID);
        removeSourceIfExists(map, ROUTE_SOURCE_ID);
        removeSourceIfExists(map, TERRAIN_SOURCE_ID);
        return;
      }

      const [start, end] = [path[0], path[path.length - 1]];
      const route = turf.greatCircle(turf.point(start), turf.point(end), {
        npoints: ROUTE_POINTS,
      });
      const baseRouteCoords = normalizeGreatCircleCoordinates(
        route.geometry,
        start,
        end
      );
      const routeCoords = buildLiftedRoute(baseRouteCoords, arcHeightScale);
      if (routeCoords.length < 2) return;

      const segmentCount = routeCoords.length - 1;
      const segmentBearings = Array.from({ length: segmentCount }, (_, i) =>
        bearingDeg(routeCoords[i], routeCoords[i + 1])
      );
      const segmentDistances = Array.from({ length: segmentCount }, (_, i) =>
        turf.distance(turf.point(routeCoords[i]), turf.point(routeCoords[i + 1]), {
          units: "kilometers",
        })
      );
      const cumulativeDistances = [0];
      for (let i = 0; i < segmentDistances.length; i += 1) {
        cumulativeDistances.push(cumulativeDistances[i] + segmentDistances[i]);
      }
      const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] || 1;

      const routeProgress: [number, number][] = [routeCoords[0], routeCoords[0]];
      const routeData = lineFeature(routeProgress);
      const planeData = pointFeature(routeCoords[0], segmentBearings[0] ?? 0);

      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data: routeData,
          lineMetrics: true,
        });
      } else {
        (map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(routeData);
      }

      if (!map.getLayer(ROUTE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": routeColor,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3,
              routeWidth,
              7,
              routeWidth + 1,
              12,
              routeWidth + 2,
            ],
            "line-blur": performanceMode ? 0 : 0.4,
            "line-gradient": performanceMode
              ? ["interpolate", ["linear"], ["line-progress"], 0, routeColor, 1, routeColor]
              : [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  adjustHexColor(routeColor, 60) ?? routeColor,
                  1,
                  adjustHexColor(routeColor, -60) ?? routeColor,
                ],
          },
        });
      }

      if (!map.getSource(PLANE_SOURCE_ID)) {
        map.addSource(PLANE_SOURCE_ID, {
          type: "geojson",
          data: planeData,
        });
      } else {
        (map.getSource(PLANE_SOURCE_ID) as mapboxgl.GeoJSONSource).setData(planeData);
      }

      if (!map.getLayer(PLANE_CORE_LAYER_ID)) {
        map.addLayer({
          id: PLANE_CORE_LAYER_ID,
          type: "circle",
          source: PLANE_SOURCE_ID,
          paint: {
            "circle-radius": fallbackRadius(planeScale),
            "circle-color": planeColor,
            "circle-opacity": 0.55,
            "circle-stroke-width": 1,
            "circle-stroke-color": adjustHexColor(planeColor, -40) ?? planeColor,
          },
        });
      }

      const hasPlaneImage = await ensurePlaneImage(map, planeColor);
      if (cancelledRef.current) return;

      if (hasPlaneImage && !map.getLayer(PLANE_LAYER_ID)) {
        map.addLayer({
          id: PLANE_LAYER_ID,
          type: "symbol",
          source: PLANE_SOURCE_ID,
          layout: {
            "icon-image": PLANE_ICON_ID,
            "icon-size": planeScale,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "viewport",
          },
          paint: {
            "icon-opacity": 1,
          },
        });
      }

      if (map.getLayer(ROUTE_LAYER_ID) && map.getLayer(PLANE_CORE_LAYER_ID)) {
        map.moveLayer(PLANE_CORE_LAYER_ID);
      }
      if (map.getLayer(ROUTE_LAYER_ID) && map.getLayer(PLANE_LAYER_ID)) {
        map.moveLayer(PLANE_LAYER_ID);
      }

      if (!performanceMode) {
        if (!map.getSource(TERRAIN_SOURCE_ID)) {
          map.addSource(TERRAIN_SOURCE_ID, {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.2 });
        if (!map.getLayer(SKY_LAYER_ID)) {
          map.addLayer({
            id: SKY_LAYER_ID,
            type: "sky",
            paint: {
              "sky-type": "atmosphere",
              "sky-atmosphere-sun": [0, 0],
              "sky-atmosphere-sun-intensity": 5,
            },
          });
        }
      } else {
        removeLayerIfExists(map, SKY_LAYER_ID);
        map.setTerrain(null);
        removeSourceIfExists(map, TERRAIN_SOURCE_ID);
      }

      const trackingPitch = performanceMode
        ? PERFORMANCE_TRACKING_PITCH
        : TRACKING_PITCH;
      const trackingBearing = performanceMode
        ? PERFORMANCE_TRACKING_BEARING
        : TRACKING_BEARING;
      const followCamera = !performanceMode;

      if (followCamera) {
        map.jumpTo({
          center: start,
          zoom: ZOOM_IN_LEVEL,
          pitch: trackingPitch,
          bearing: trackingBearing,
        });
      } else {
        const staticBounds = routeCoords.reduce(
          (acc, coord) => acc.extend(coord),
          new mapboxgl.LngLatBounds(routeCoords[0], routeCoords[0])
        );
        map.fitBounds(staticBounds, {
          padding: 80,
          duration: 0,
          pitch: OUTRO_PITCH,
          bearing: OUTRO_BEARING,
        });
      }

      holdTimeoutRef.current = setTimeout(() => {
        holdTimeoutRef.current = null;
        if (cancelledRef.current) return;

        const startTime = performance.now();
        const stepMs = 1000 / (fixedFps && fixedFps > 0 ? fixedFps : DEFAULT_ANIMATION_FPS);
        let lastStepBucket = -1;
        let segIndex = 0;
        let lastRouteUpdateAt = 0;
        let lastCameraUpdateAt = 0;

        if (followCamera) {
          map.jumpTo({
            center: routeCoords[0],
            zoom: TRACKING_ZOOM,
            pitch: trackingPitch,
            bearing: trackingBearing,
          });
        }

        const tick = (now: number) => {
          if (cancelledRef.current) return;
          const mapInstance = mapRef.current;
          if (!mapInstance) return;

          const rawElapsed = now - startTime;
          const bucket = Math.floor(rawElapsed / stepMs);
          if (bucket === lastStepBucket && rawElapsed < flightDurationMs) {
            animationFrameRef.current = requestAnimationFrame(tick);
            return;
          }
          lastStepBucket = bucket;
          const elapsed = bucket * stepMs;

          const t = Math.min(elapsed / flightDurationMs, 1);
          const eased = easeInOutCubic(t);
          const targetDistance = eased * totalDistance;

          while (
            segIndex < segmentCount - 1 &&
            targetDistance > cumulativeDistances[segIndex + 1]
          ) {
            segIndex += 1;
            routeProgress.splice(routeProgress.length - 1, 0, routeCoords[segIndex]);
          }

          const segStart = cumulativeDistances[segIndex];
          const segLen = segmentDistances[segIndex] || 1;
          const segT = Math.min(Math.max((targetDistance - segStart) / segLen, 0), 1);

          const a = routeCoords[segIndex];
          const b = routeCoords[Math.min(segIndex + 1, routeCoords.length - 1)];
          const pos = lerp(a, b, segT);
          const bearing = segmentBearings[segIndex] ?? segmentBearings[segmentBearings.length - 1] ?? 0;

          if (followCamera && (now - lastCameraUpdateAt >= CAMERA_UPDATE_INTERVAL_MS || t >= 1)) {
            mapInstance.setCenter(pos);
            lastCameraUpdateAt = now;
          }

          const planeSource = mapInstance.getSource(PLANE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
          if (planeSource) {
            planeSource.setData(pointFeature(pos, bearing));
          }

          const routeSource = mapInstance.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
          if (routeSource) {
            const routeUpdateInterval = performanceMode ? 70 : 45;
            if (now - lastRouteUpdateAt >= routeUpdateInterval || t >= 1) {
              routeProgress[routeProgress.length - 1] = pos;
              routeSource.setData(routeData);
              lastRouteUpdateAt = now;
            }
          }

          if (t < 1) {
            animationFrameRef.current = requestAnimationFrame(tick);
            return;
          }

          animationFrameRef.current = null;
          if (cancelledRef.current) return;

          const bounds = routeCoords.reduce(
            (acc, coord) => acc.extend(coord),
            new mapboxgl.LngLatBounds(routeCoords[0], routeCoords[0])
          );

          mapInstance.fitBounds(bounds, {
            padding: 80,
            duration: ZOOM_OUT_DURATION_MS,
            essential: true,
            pitch: OUTRO_PITCH,
            bearing: OUTRO_BEARING,
          });
          mapInstance.once("moveend", () => onSequenceCompleteRef.current?.());
        };

        animationFrameRef.current = requestAnimationFrame(tick);
      }, SOURCE_HOLD_MS);
    };

    void run();

    return () => {
      cleanupSequence();
    };
  }, [
    path,
    replayTrigger,
    arcHeightScale,
    routeColor,
    routeWidth,
    planeColor,
    planeScale,
    flightDurationMs,
    performanceMode,
    fixedFps,
    mapStyle,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer(PLANE_LAYER_ID)) {
      map.setLayoutProperty(PLANE_LAYER_ID, "icon-size", planeScale);
    }
    if (map.getLayer(PLANE_CORE_LAYER_ID)) {
      map.setPaintProperty(PLANE_CORE_LAYER_ID, "circle-color", planeColor);
      map.setPaintProperty(
        PLANE_CORE_LAYER_ID,
        "circle-stroke-color",
        adjustHexColor(planeColor, -40) ?? planeColor
      );
      map.setPaintProperty(PLANE_CORE_LAYER_ID, "circle-radius", fallbackRadius(planeScale));
    }
  }, [planeColor, planeScale]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(ROUTE_LAYER_ID)) return;

    map.setPaintProperty(ROUTE_LAYER_ID, "line-color", routeColor);
    map.setPaintProperty(ROUTE_LAYER_ID, "line-width", [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      routeWidth,
      7,
      routeWidth + 1,
      12,
      routeWidth + 2,
    ]);
    map.setPaintProperty(ROUTE_LAYER_ID, "line-blur", performanceMode ? 0 : 0.4);

    if (performanceMode) {
      map.setPaintProperty(ROUTE_LAYER_ID, "line-gradient", [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        routeColor,
        1,
        routeColor,
      ]);
      return;
    }

    const lighter = adjustHexColor(routeColor, 60) ?? routeColor;
    const darker = adjustHexColor(routeColor, -60) ?? routeColor;
    map.setPaintProperty(ROUTE_LAYER_ID, "line-gradient", [
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      lighter,
      1,
      darker,
    ]);
  }, [routeColor, routeWidth, performanceMode]);

  return (
    <div
      ref={mapContainer}
      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ height: "500px" }}
    />
  );
}
