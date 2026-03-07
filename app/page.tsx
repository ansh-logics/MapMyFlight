"use client";

import { useCallback, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import Map from "@/components/Map";

const MAPBOX_GEOCODE =
  "https://api.mapbox.com/geocoding/v5/mapbox.places";

async function geocode(
  query: string,
  token: string
): Promise<[number, number] | null> {
  if (!query.trim()) return null;
  const url = `${MAPBOX_GEOCODE}/${encodeURIComponent(query.trim())}.json?access_token=${token}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature?.center || feature.center.length < 2) return null;
  return [feature.center[0], feature.center[1]];
}

const RECORD_FPS = 30;

export default function Home() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [path, setPath] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [replayTrigger, setReplayTrigger] = useState(0);
  const [planeColor, setPlaneColor] = useState("#22C55E");
  const [planeScale, setPlaneScale] = useState(0.42);
  const [routeColor, setRouteColor] = useState("#3B82F6");
  const [routeWidth, setRouteWidth] = useState(3);
  const [arcHeightScale, setArcHeightScale] = useState(0.06);
  const [flightDurationMs, setFlightDurationMs] = useState(3200);
  const [mapStyle, setMapStyle] = useState("mapbox://styles/mapbox/light-v11");

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onMapReady = useCallback((map: mapboxgl.Map) => {
    mapRef.current = map;
  }, []);

  const onSequenceComplete = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `travel-map-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      chunksRef.current = [];
      recorderRef.current = null;
      setRecording(false);
    };
    recorder.stop();
  }, []);

  const token =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN
      : undefined;

  function handleRecord() {
    const map = mapRef.current;
    if (!path || path.length < 2) {
      setError("Generate a route first.");
      return;
    }
    if (!map) {
      setError("Map not ready. Wait a moment and try again.");
      return;
    }
    setError(null);
    const canvas = map.getCanvas();
    const stream = canvas.captureStream(RECORD_FPS);
    const options: MediaRecorderOptions = { videoBitsPerSecond: 2_500_000 };
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
      options.mimeType = "video/webm;codecs=vp9";
    }
    const recorder = new MediaRecorder(stream, options);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start(100);
    setRecording(true);
    setReplayTrigger((t) => t + 1);
  }

  async function handleGenerate() {
    setError(null);
    if (!from.trim() || !to.trim()) {
      setError("Please enter both From and To locations.");
      return;
    }
    if (!token) {
      setError("Mapbox token is missing. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local");
      return;
    }

    setLoading(true);
    try {
      const [fromCoords, toCoords] = await Promise.all([
        geocode(from, token),
        geocode(to, token),
      ]);

      if (!fromCoords) {
        setError(`Could not find location: "${from}"`);
        return;
      }
      if (!toCoords) {
        setError(`Could not find location: "${to}"`);
        return;
      }

      setPath([fromCoords, toCoords]);
    } catch (e) {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Travel Map Generator
        </h1>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="from"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              From
            </label>
            <input
              id="from"
              type="text"
              placeholder="e.g. Delhi"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
            />
          </div>
          <div className="flex-1">
            <label
              htmlFor="to"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              To
            </label>
            <input
              id="to"
              type="text"
              placeholder="e.g. Tokyo"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
            />
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="shrink-0 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 disabled:pointer-events-none"
          >
            {loading ? "Finding route…" : "Generate Route"}
          </button>
          <button
            type="button"
            onClick={handleRecord}
            disabled={!path || path.length < 2 || recording}
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 disabled:pointer-events-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {recording ? "Recording…" : "Record video"}
          </button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="plane-color"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Plane color
            </label>
            <div className="flex items-center gap-3">
              <input
                id="plane-color"
                type="color"
                value={planeColor}
                onChange={(e) => setPlaneColor(e.target.value)}
                className="h-10 w-16 rounded border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {planeColor.toUpperCase()}
              </span>
            </div>
          </div>
          <div>
            <label
              htmlFor="plane-size"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Plane size
            </label>
            <div className="flex items-center gap-3">
              <input
                id="plane-size"
                type="range"
                min="0.2"
                max="0.7"
                step="0.02"
                value={planeScale}
                onChange={(e) => setPlaneScale(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {planeScale.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="route-color"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Route color
            </label>
            <div className="flex items-center gap-3">
              <input
                id="route-color"
                type="color"
                value={routeColor}
                onChange={(e) => setRouteColor(e.target.value)}
                className="h-10 w-16 rounded border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {routeColor.toUpperCase()}
              </span>
            </div>
          </div>
          <div>
            <label
              htmlFor="route-width"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Route width
            </label>
            <div className="flex items-center gap-3">
              <input
                id="route-width"
                type="range"
                min="1"
                max="8"
                step="1"
                value={routeWidth}
                onChange={(e) => setRouteWidth(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {routeWidth}px
              </span>
            </div>
          </div>
          <div>
            <label
              htmlFor="arc-height"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Arc height
            </label>
            <div className="flex items-center gap-3">
              <input
                id="arc-height"
                type="range"
                min="0.02"
                max="0.12"
                step="0.01"
                value={arcHeightScale}
                onChange={(e) => setArcHeightScale(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {arcHeightScale.toFixed(2)}
              </span>
            </div>
          </div>
          <div>
            <label
              htmlFor="flight-speed"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Flight duration
            </label>
            <div className="flex items-center gap-3">
              <input
                id="flight-speed"
                type="range"
                min="2000"
                max="7000"
                step="100"
                value={flightDurationMs}
                onChange={(e) => setFlightDurationMs(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {(flightDurationMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="map-style"
              className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Map style
            </label>
            <select
              id="map-style"
              value={mapStyle}
              onChange={(e) => setMapStyle(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="mapbox://styles/mapbox/light-v11">Light</option>
              <option value="mapbox://styles/mapbox/dark-v11">Dark</option>
              <option value="mapbox://styles/mapbox/streets-v12">Streets</option>
              <option value="mapbox://styles/mapbox/outdoors-v12">Outdoors</option>
              <option value="mapbox://styles/mapbox/satellite-streets-v12">
                Satellite
              </option>
            </select>
          </div>
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <Map
          path={path}
          replayTrigger={replayTrigger}
          onMapReady={onMapReady}
          onSequenceComplete={onSequenceComplete}
          planeColor={planeColor}
          planeScale={planeScale}
          routeColor={routeColor}
          routeWidth={routeWidth}
          arcHeightScale={arcHeightScale}
          flightDurationMs={flightDurationMs}
          mapStyle={mapStyle}
        />
      </div>
    </main>
  );
}
