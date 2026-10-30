import type mapboxgl from "mapbox-gl";
import type { RenderSpecV1, RoutePoint } from "./render-spec";
import { pointAlongRoute, routeGeoJson } from "./route-geometry";

/**
 * The Mapbox side of a flight scene — route lines, airport markers and
 * labels, 3D terrain and fog. Shared by the studio preview and the landing
 * page hero so both show exactly the same world. The aircraft, trail and
 * pulses are drawn separately on a canvas (see flight-graphics.ts).
 */

export const ROUTE_GHOST = "studio-route-ghost";
export const ROUTE_ACTIVE = "studio-route-active";
export const ROUTE_SOURCE = "studio-route";
export const ACTIVE_SOURCE = "studio-active-route";
export const POINTS_SOURCE = "studio-points";
export const POINT_LABELS = "studio-point-labels";
export const TERRAIN_SOURCE = "studio-terrain-dem";

const LAYERS = [POINT_LABELS, "studio-points", "studio-point-halo", ROUTE_ACTIVE, ROUTE_GHOST];
const SOURCES = [POINTS_SOURCE, ACTIVE_SOURCE, ROUTE_SOURCE];

export function installFlightScene(map: mapboxgl.Map, spec: RenderSpecV1, route: RoutePoint[]) {
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
}

export function removeFlightScene(map: mapboxgl.Map) {
  for (const id of LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of SOURCES) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

/** Draws the travelled part of the route up to `progress` (0–1). */
export function setRouteProgress(map: mapboxgl.Map, route: RoutePoint[], progress: number) {
  const { point, index } = pointAlongRoute(route, progress);
  const partial = route.slice(0, index + 1);
  partial.push(point);
  (map.getSource(ACTIVE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(routeGeoJson(partial));
}
