"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from "@turf/turf";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const DEFAULT_CENTER: [number, number] = [77.209, 28.6139]; // Delhi
const DEFAULT_ZOOM = 3;
const SOURCE_HOLD_MS = 2000; // zoom on source before takeoff
const FLIGHT_DURATION_MS = 6000; // plane flies straight from source to dest
const ZOOM_OUT_DURATION_MS = 2000; // reveal full journey at end
const ZOOM_IN_LEVEL = 11; // zoom on source and for detail
const TRACKING_ZOOM = 5.5; // zoom while camera follows the plane
const TRACKING_PITCH = 55; // tilt camera for 3D feel
const TRACKING_BEARING = -20; // slight rotation for depth
const PERFORMANCE_TRACKING_PITCH = 35;
const PERFORMANCE_TRACKING_BEARING = -10;
const OUTRO_PITCH = 0;
const OUTRO_BEARING = 0;
const PLANE_ICON_ID = "plane-icon";
const PLANE_ICON_SCALE = 0.8; // default size of plane icon
const MAX_ICON_PIXEL_RATIO = 2;
const PLANE_SVG = `<svg width="64" height="64" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <g fill="#ffffff">
    <path d="M256 0c-10 0-18 8-18 18v160L64 256v36l174-36v160l-46 32v32l64-18 64 18v-32l-46-32V256l174 36v-36L274 178V18c0-10-8-18-18-18z"/>
  </g>
</svg>`;
const PLANE_SVG_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  PLANE_SVG
)}`;
const ROUTE_POINTS = 120;

function lerp(
  start: [number, number],
  end: [number, number],
  t: number
): [number, number] {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
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

function buildLiftedRoute(
  coords: [number, number][],
  heightScale: number
): [number, number][] {
  if (coords.length < 2) return coords;
  const distanceKm = turf.distance(turf.point(coords[0]), turf.point(coords[coords.length - 1]), {
    units: "kilometers",
  });
  const scaled = distanceKm * heightScale;
  const maxHeightKm = Math.min(800, Math.max(40, scaled));
  const lastIndex = coords.length - 1;

  return coords.map((coord, idx) => {
    const t = idx / lastIndex;
    const heightKm = Math.sin(Math.PI * t) * maxHeightKm;
    if (heightKm <= 0.0001) return coord;
    const prev = coords[Math.max(idx - 1, 0)];
    const next = coords[Math.min(idx + 1, lastIndex)];
    const tangent = turf.bearing(turf.point(prev), turf.point(next));
    const offsetBearing = tangent + 90;
    const shifted = turf.destination(turf.point(coord), heightKm, offsetBearing, {
      units: "kilometers",
    });
    return shifted.geometry.coordinates as [number, number];
  });
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
  const base = 8;
  const factor = Math.max(0.6, scale / PLANE_ICON_SCALE);
  return Math.min(22, Math.max(6, base * factor));
}

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

export default function Map({
  path,
  replayTrigger = 0,
  onMapReady,
  onSequenceComplete,
  planeColor = "#22C55E",
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
  const map = useRef<mapboxgl.Map | null>(null);
  const animationFrame = useRef<number | null>(null);
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const onSequenceCompleteRef = useRef(onSequenceComplete);
  const planeImageReady = useRef<Promise<void> | null>(null);

  useEffect(() => {
    onSequenceCompleteRef.current = onSequenceComplete;
  }, [onSequenceComplete]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    map.current = m;
    onMapReady?.(m);
  }, [onMapReady, mapStyle]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    cancelled.current = false;

    const ensurePlaneImage = (mapInstance: mapboxgl.Map = m) => {
      if (planeImageReady.current) {
        if (mapInstance.hasImage(PLANE_ICON_ID)) {
          return planeImageReady.current;
        }
        planeImageReady.current = null;
      }
      planeImageReady.current = new Promise((resolve) => {
        if (mapInstance.hasImage(PLANE_ICON_ID)) {
          resolve();
          return;
        }
        const addPlaneImage = (image: mapboxgl.Image | HTMLImageElement | ImageBitmap) => {
          if (mapInstance.hasImage(PLANE_ICON_ID)) return;
          const pixelRatio = Math.min(
            window.devicePixelRatio || 1,
            MAX_ICON_PIXEL_RATIO
          );
          mapInstance.addImage(PLANE_ICON_ID, image, { pixelRatio, sdf: true });
        };

        const svgBlob = new Blob([PLANE_SVG], { type: "image/svg+xml" });
        if ("createImageBitmap" in window) {
          createImageBitmap(svgBlob)
            .then((bitmap) => {
              addPlaneImage(bitmap);
              resolve();
            })
            .catch(() => {
              mapInstance.loadImage(PLANE_SVG_URI, (err, image) => {
                if (!err && image) {
                  addPlaneImage(image);
                  resolve();
                  return;
                }
                const img = new Image();
                img.onload = () => {
                  addPlaneImage(img);
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = PLANE_SVG_URI;
              });
            });
          return;
        }

        mapInstance.loadImage(PLANE_SVG_URI, (err, image) => {
          if (!err && image) {
            addPlaneImage(image);
            resolve();
            return;
          }
          const img = new Image();
          img.onload = () => {
            addPlaneImage(img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = PLANE_SVG_URI;
        });
      });
      return planeImageReady.current;
    };

    const onStyleImageMissing = (e: mapboxgl.StyleImageMissingEvent) => {
      if (e.id === PLANE_ICON_ID) {
        void ensurePlaneImage(m);
      }
    };

    const onLoad = () => {
      if (holdTimeout.current != null) {
        clearTimeout(holdTimeout.current);
        holdTimeout.current = null;
      }
      if (animationFrame.current != null) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }

      if (!path || path.length < 2) {
        if (m.getLayer("plane")) m.removeLayer("plane");
        if (m.getLayer("plane-shadow")) m.removeLayer("plane-shadow");
        if (m.getLayer("plane-fallback")) m.removeLayer("plane-fallback");
        if (m.getSource("plane-position")) m.removeSource("plane-position");
        if (m.getLayer("route")) m.removeLayer("route");
        if (m.getSource("route")) m.removeSource("route");
        return;
      }

      const [start, end] = [path[0], path[path.length - 1]];

      const routeFeature = turf.greatCircle(turf.point(start), turf.point(end), {
        npoints: ROUTE_POINTS,
      });
      const rawCoords = routeFeature.geometry?.coordinates;
      const baseRouteCoords =
        Array.isArray(rawCoords) && rawCoords.length >= 2
          ? (rawCoords as [number, number][])
          : [start, end];
      const routeCoords = buildLiftedRoute(baseRouteCoords, arcHeightScale);
      const segmentCount = Math.max(routeCoords.length - 1, 1);
      const segmentBearings = Array.from({ length: segmentCount }, (_, idx) =>
        bearingDeg(routeCoords[idx], routeCoords[idx + 1] ?? end)
      );
      const segmentDistances = Array.from({ length: segmentCount }, (_, idx) =>
        turf.distance(turf.point(routeCoords[idx]), turf.point(routeCoords[idx + 1] ?? end), {
          units: "kilometers",
        })
      );
      const cumulativeDistances = [0];
      for (let i = 0; i < segmentDistances.length; i += 1) {
        cumulativeDistances.push(cumulativeDistances[i] + segmentDistances[i]);
      }
      const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] || 1;

      const progressFeature = (coords: [number, number][]) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: coords,
        },
      });

      const progressLine: [number, number][] = [routeCoords[0], routeCoords[0]];
      const progressGeojson = progressFeature(progressLine);

      if (m.getSource("route")) {
        (m.getSource("route") as mapboxgl.GeoJSONSource).setData(progressGeojson);
      } else {
        m.addSource("route", {
          type: "geojson",
          data: progressGeojson,
          lineMetrics: true,
        });
        m.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": routeColor,
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, routeWidth, 7, routeWidth + 1, 12, routeWidth + 2],
            "line-blur": performanceMode ? 0 : 0.4,
            "line-gradient": performanceMode
              ? [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  routeColor,
                  1,
                  routeColor,
                ]
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

      const bounds = routeCoords.reduce(
        (acc, coord) => acc.extend(coord),
        new mapboxgl.LngLatBounds(routeCoords[0], routeCoords[0])
      );

      if (!performanceMode) {
        if (!m.getSource("mapbox-dem")) {
          m.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
          m.setTerrain({ source: "mapbox-dem", exaggeration: 1.2 });
        }
        if (!m.getLayer("sky")) {
          m.addLayer({
            id: "sky",
            type: "sky",
            paint: {
              "sky-type": "atmosphere",
              "sky-atmosphere-sun": [0, 0],
              "sky-atmosphere-sun-intensity": 5,
            },
          });
        }
      } else {
        if (m.getLayer("sky")) m.removeLayer("sky");
        if (m.getSource("mapbox-dem")) m.removeSource("mapbox-dem");
        m.setTerrain(null);
      }

      // Plane as symbol layer so it is drawn on the map canvas (included in recordings)
      const planeFeature = (coords: [number, number], bearing: number) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: coords,
        },
        properties: {
          bearing,
        },
      });

      const initialBearing = turf.bearing(
        turf.point(start),
        turf.point(routeCoords[1] ?? end)
      );

      if (!m.getSource("plane-position")) {
        m.addSource("plane-position", {
          type: "geojson",
          data: planeFeature(start, initialBearing),
        });
      } else {
        (m.getSource("plane-position") as mapboxgl.GeoJSONSource).setData(
          planeFeature(start, initialBearing)
        );
      }

      if (!m.getLayer("plane-fallback")) {
        m.addLayer({
          id: "plane-fallback",
          type: "circle",
          source: "plane-position",
          paint: {
            "circle-radius": fallbackRadius(planeScale),
            "circle-color": planeColor,
            "circle-opacity": 0.9,
            "circle-stroke-width": 2,
            "circle-stroke-color": adjustHexColor(planeColor, -40) ?? planeColor,
          },
        });
      }

      const ready = ensurePlaneImage();
      ready.then(() => {
        if (cancelled.current) return;
        if (m.hasImage(PLANE_ICON_ID)) {
          if (m.getLayer("plane-fallback")) {
            m.removeLayer("plane-fallback");
          }
          if (!m.getLayer("plane")) {
            m.addLayer({
              id: "plane",
              type: "symbol",
              source: "plane-position",
              layout: {
                "icon-image": PLANE_ICON_ID,
                "icon-size": planeScale,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-rotate": ["get", "bearing"],
                "icon-rotation-alignment": "map",
                "icon-pitch-alignment": "map",
              },
              paint: {
                "icon-opacity": 1,
                "icon-color": planeColor,
              },
            });
            if (m.getLayer("route")) {
              m.moveLayer("plane");
            }
          }
          return;
        }
        if (!m.getLayer("plane-fallback")) {
          m.addLayer({
            id: "plane-fallback",
            type: "circle",
            source: "plane-position",
            paint: {
              "circle-radius": fallbackRadius(planeScale),
              "circle-color": planeColor,
              "circle-opacity": 0.9,
              "circle-stroke-width": 2,
              "circle-stroke-color": adjustHexColor(planeColor, -40) ?? planeColor,
            },
          });
          if (m.getLayer("route")) {
            m.moveLayer("plane-fallback");
          }
        }
      });

      function runPlaneAnimation() {
        const easeInOut = (t: number) =>
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const startTime = performance.now();
        let segIndex = 0;
        let lastRouteUpdate = 0;
        let lastPlaneUpdate = 0;
        let lastCameraUpdate = 0;
        let lastStepBucket = -1;
        const fixedStepMs = fixedFps && fixedFps > 0 ? 1000 / fixedFps : 0;
        const ROUTE_UPDATE_MS = performanceMode ? 70 : 50;
        const PLANE_UPDATE_MS = performanceMode ? 33 : 16;
        const CAMERA_UPDATE_MS = performanceMode ? 33 : 16;
        const trackingPitch = performanceMode
          ? PERFORMANCE_TRACKING_PITCH
          : TRACKING_PITCH;
        const trackingBearing = performanceMode
          ? PERFORMANCE_TRACKING_BEARING
          : TRACKING_BEARING;

        m.jumpTo({
          center: routeCoords[0] ?? start,
          zoom: TRACKING_ZOOM,
          pitch: trackingPitch,
          bearing: trackingBearing,
        });

        const tick = (now: number) => {
          if (cancelled.current) return;
          const mapInstance = map.current;
          if (!mapInstance) return;
          const rawElapsed = now - startTime;
          let elapsed = rawElapsed;
          if (fixedStepMs > 0) {
            const bucket = Math.floor(rawElapsed / fixedStepMs);
            if (bucket === lastStepBucket && rawElapsed < flightDurationMs) {
              animationFrame.current = requestAnimationFrame(tick);
              return;
            }
            lastStepBucket = bucket;
            elapsed = bucket * fixedStepMs;
          }
          const t = Math.min(elapsed / flightDurationMs, 1);
          const eased = easeInOut(t);
          const targetDistance = eased * totalDistance;
          while (
            segIndex < segmentCount - 1 &&
            targetDistance > cumulativeDistances[segIndex + 1]
          ) {
            segIndex += 1;
            progressLine.splice(progressLine.length - 1, 0, routeCoords[segIndex]);
          }
          const segStart = cumulativeDistances[segIndex];
          const segLen = segmentDistances[segIndex] || 1;
          const segT = Math.min(Math.max((targetDistance - segStart) / segLen, 0), 1);
          const a = routeCoords[segIndex] ?? start;
          const b = routeCoords[segIndex + 1] ?? end;
          const pos = lerp(a, b, segT);
          const bearing = segmentBearings[segIndex] ?? 0;

          const nowMs = performance.now();
          if (
            nowMs - lastCameraUpdate >= (fixedStepMs > 0 ? fixedStepMs : CAMERA_UPDATE_MS) ||
            t >= 1
          ) {
            mapInstance.setCenter(pos);
            lastCameraUpdate = nowMs;
          }
          if (
            nowMs - lastPlaneUpdate >= (fixedStepMs > 0 ? fixedStepMs : PLANE_UPDATE_MS) ||
            t >= 1
          ) {
            (mapInstance.getSource("plane-position") as mapboxgl.GeoJSONSource).setData(
              planeFeature(pos, bearing)
            );
            lastPlaneUpdate = nowMs;
          }
          if (nowMs - lastRouteUpdate >= ROUTE_UPDATE_MS || segT > 0.95) {
            progressLine[progressLine.length - 1] = pos;
            (mapInstance.getSource("route") as mapboxgl.GeoJSONSource).setData(
              progressGeojson
            );
            lastRouteUpdate = nowMs;
          }

          if (t < 1) {
            animationFrame.current = requestAnimationFrame(tick);
          } else {
            animationFrame.current = null;
            if (cancelled.current) return;
            // 3) Zoom out smoothly to show the whole journey
            mapInstance.fitBounds(bounds, {
              padding: 80,
              duration: ZOOM_OUT_DURATION_MS,
              essential: true,
              pitch: OUTRO_PITCH,
              bearing: OUTRO_BEARING,
            });
            mapInstance.once("moveend", () => onSequenceCompleteRef.current?.());
          }
        };

        animationFrame.current = requestAnimationFrame(tick);
      }

      let startQueued = false;
      const queueStart = () => {
        if (startQueued || cancelled.current) return;
        startQueued = true;

        const startSequence = () => {
          if (cancelled.current) return;
          // Pre-render complete, now start cinematic movement.
          m.jumpTo({
            center: start,
            zoom: ZOOM_IN_LEVEL,
            pitch: performanceMode ? PERFORMANCE_TRACKING_PITCH : TRACKING_PITCH,
            bearing: performanceMode ? PERFORMANCE_TRACKING_BEARING : TRACKING_BEARING,
          });
          holdTimeout.current = setTimeout(() => {
            holdTimeout.current = null;
            if (cancelled.current) return;
            runPlaneAnimation();
          }, SOURCE_HOLD_MS);
        };

        const afterPaint = () =>
          requestAnimationFrame(() => requestAnimationFrame(startSequence));

        if (m.areTilesLoaded()) {
          afterPaint();
        } else {
          m.once("idle", afterPaint);
        }
      };

      ready.finally(queueStart);
    };

    if (m.isStyleLoaded()) {
      onLoad();
    } else {
      m.on("load", onLoad);
    }
    m.on("style.load", onLoad);
    m.on("styleimagemissing", onStyleImageMissing);

    return () => {
      cancelled.current = true;
      m.stop();
      m.off("load", onLoad);
      m.off("style.load", onLoad);
      m.off("styleimagemissing", onStyleImageMissing);
      if (holdTimeout.current != null) {
        clearTimeout(holdTimeout.current);
        holdTimeout.current = null;
      }
      if (animationFrame.current != null) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
    };
  }, [
    path,
    replayTrigger,
    arcHeightScale,
    routeColor,
    routeWidth,
    flightDurationMs,
    performanceMode,
    fixedFps,
    planeColor,
    planeScale,
  ]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (m.getLayer("plane")) {
      m.setPaintProperty("plane", "icon-color", planeColor);
      m.setLayoutProperty("plane", "icon-size", planeScale);
    }
    if (m.getLayer("plane-fallback")) {
      m.setPaintProperty("plane-fallback", "circle-color", planeColor);
      m.setPaintProperty(
        "plane-fallback",
        "circle-stroke-color",
        adjustHexColor(planeColor, -40) ?? planeColor
      );
      m.setPaintProperty("plane-fallback", "circle-radius", fallbackRadius(planeScale));
    }
  }, [planeColor, planeScale]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    planeImageReady.current = null;
    if (!m.loaded()) {
      m.once("load", () => m.setStyle(mapStyle));
      return;
    }
    m.setStyle(mapStyle);
  }, [mapStyle]);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.getLayer("route")) return;
    m.setPaintProperty("route", "line-color", routeColor);
    m.setPaintProperty("route", "line-width", [
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
    m.setPaintProperty("route", "line-blur", performanceMode ? 0 : 0.4);
    if (performanceMode) {
      m.setPaintProperty("route", "line-gradient", [
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
    m.setPaintProperty("route", "line-gradient", [
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
