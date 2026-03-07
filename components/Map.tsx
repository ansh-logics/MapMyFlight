"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from "@turf/turf";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const DEFAULT_CENTER: [number, number] = [77.209, 28.6139]; // Delhi
const DEFAULT_ZOOM = 3;
const SOURCE_HOLD_MS = 2000; // zoom on source before takeoff
const FLIGHT_DURATION_MS = 3200; // plane flies straight from source to dest
const ZOOM_OUT_DURATION_MS = 2000; // reveal full journey at end
const ZOOM_IN_LEVEL = 11; // zoom on source and for detail
const TRACKING_ZOOM = 5.5; // zoom while camera follows the plane
const TRACKING_PITCH = 55; // tilt camera for 3D feel
const TRACKING_BEARING = -20; // slight rotation for depth
const OUTRO_PITCH = 0;
const OUTRO_BEARING = 0;
const PLANE_ICON_ID = "plane-icon";
const PLANE_ICON_SCALE = 0.42; // default size of plane icon
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
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const animationFrame = useRef<number | null>(null);
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const onSequenceCompleteRef = useRef(onSequenceComplete);
  onSequenceCompleteRef.current = onSequenceComplete;
  const planeImageReady = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    m.on("load", () => {
      if (!planeImageReady.current) {
        planeImageReady.current = new Promise((resolve) => resolve());
      }
    });
    map.current = m;
    onMapReady?.(m);
  }, [onMapReady]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    cancelled.current = false;

    const ensurePlaneImage = () => {
      if (planeImageReady.current) return planeImageReady.current;
      planeImageReady.current = new Promise((resolve) => {
        if (m.hasImage(PLANE_ICON_ID)) {
          resolve();
          return;
        }
        const img = new Image();
        img.onload = () => {
          if (!m.hasImage(PLANE_ICON_ID)) {
            const pixelRatio = Math.min(
              window.devicePixelRatio || 1,
              MAX_ICON_PIXEL_RATIO
            );
            m.addImage(PLANE_ICON_ID, img, { pixelRatio, sdf: true });
          }
          resolve();
        };
        img.onerror = () => {
          resolve();
        };
        img.src = PLANE_SVG_URI;
      });
      return planeImageReady.current;
    };

    const onLoad = () => {
      if (!path || path.length < 2) {
        if (m.getLayer("plane")) m.removeLayer("plane");
        if (m.getLayer("plane-shadow")) m.removeLayer("plane-shadow");
        if (m.getSource("plane-position")) m.removeSource("plane-position");
        if (m.getLayer("route")) m.removeLayer("route");
        if (m.getSource("route")) m.removeSource("route");
        return;
      }

      const ready = ensurePlaneImage();
      ready.then(() => {
        if (cancelled.current) return;
        if (!m.hasImage(PLANE_ICON_ID)) return;

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

        const progressFeature = (coords: [number, number][]) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: coords,
          },
        });

        if (m.getSource("route")) {
          (m.getSource("route") as mapboxgl.GeoJSONSource).setData(
            progressFeature([routeCoords[0]])
          );
        } else {
          m.addSource("route", {
            type: "geojson",
            data: progressFeature([routeCoords[0]]),
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
              "line-blur": 0.4,
              "line-gradient": [
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
          m.addLayer({
            id: "plane-shadow",
            type: "circle",
            source: "plane-position",
            paint: {
              "circle-radius": 6,
              "circle-color": "#000000",
              "circle-opacity": 0.25,
              "circle-blur": 0.7,
              "circle-translate": [6, 6],
              "circle-translate-anchor": "map",
            },
          });
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
        } else {
          (m.getSource("plane-position") as mapboxgl.GeoJSONSource).setData(
            planeFeature(start, initialBearing)
          );
        }

        // 1) Cinematic zoom on source for 2s (then plane takes off)
        m.jumpTo({
          center: start,
          zoom: ZOOM_IN_LEVEL,
          pitch: TRACKING_PITCH,
          bearing: TRACKING_BEARING,
        });

        function runPlaneAnimation() {
          const easeInOut = (t: number) =>
            t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          const startTime = performance.now();
          const segments = Math.max(routeCoords.length - 1, 1);

          const tick = (now: number) => {
            if (cancelled.current) return;
            const mapInstance = map.current;
            if (!mapInstance) return;
            const elapsed = now - startTime;
            const t = Math.min(elapsed / flightDurationMs, 1);
            const eased = easeInOut(t);
            const progress = eased * segments;
            const i = Math.min(Math.floor(progress), segments - 1);
            const segmentT = progress - i;
            const a = routeCoords[i] ?? start;
            const b = routeCoords[i + 1] ?? end;
            const pos = lerp(a, b, segmentT);
            const bearing = turf.bearing(turf.point(a), turf.point(b));

            mapInstance.setCenter(pos);
            mapInstance.setZoom(TRACKING_ZOOM);
            mapInstance.setPitch(TRACKING_PITCH);
            mapInstance.setBearing(TRACKING_BEARING);
            (mapInstance.getSource("plane-position") as mapboxgl.GeoJSONSource).setData(
              planeFeature(pos, bearing)
            );
            const routeProgress = routeCoords.slice(0, i + 1);
            routeProgress.push(pos);
            (mapInstance.getSource("route") as mapboxgl.GeoJSONSource).setData(
              progressFeature(routeProgress)
            );

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

        holdTimeout.current = setTimeout(() => {
          holdTimeout.current = null;
          if (cancelled.current) return;
          runPlaneAnimation();
        }, SOURCE_HOLD_MS);
      });
    };

    if (m.isStyleLoaded()) {
      onLoad();
    } else {
      m.on("load", onLoad);
    }
    m.on("style.load", onLoad);

    return () => {
      cancelled.current = true;
      m.stop();
      m.off("load", onLoad);
      m.off("style.load", onLoad);
      if (holdTimeout.current != null) {
        clearTimeout(holdTimeout.current);
        holdTimeout.current = null;
      }
      if (animationFrame.current != null) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
    };
  }, [path, replayTrigger, arcHeightScale, routeColor, routeWidth, flightDurationMs]);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.getLayer("plane")) return;
    m.setPaintProperty("plane", "icon-color", planeColor);
    m.setLayoutProperty("plane", "icon-size", planeScale);
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
  }, [routeColor, routeWidth]);

  return (
    <div
      ref={mapContainer}
      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ height: "500px" }}
    />
  );
}
