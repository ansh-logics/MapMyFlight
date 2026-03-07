"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const RECORD_LEAD_IN_MS = 500;

const RECORD_PRESETS = {
  smooth: {
    label: "MVP Smooth (720p, 30fps)",
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 8_000_000,
  },
  quality: {
    label: "High Quality (1080p, 60fps)",
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 16_000_000,
  },
} as const;

type RecordPresetKey = keyof typeof RECORD_PRESETS;
type RecorderMode = "stable-mp4" | "webm";

export default function Home() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [path, setPath] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [replayTrigger, setReplayTrigger] = useState(0);
  const [planeColor, setPlaneColor] = useState("#22C55E");
  const [planeScale, setPlaneScale] = useState(0.8);
  const [routeColor, setRouteColor] = useState("#3B82F6");
  const [routeWidth, setRouteWidth] = useState(3);
  const [arcHeightScale, setArcHeightScale] = useState(0.06);
  const [flightDurationMs, setFlightDurationMs] = useState(6000);
  const [mapStyle, setMapStyle] = useState("mapbox://styles/mapbox/light-v11");
  const [performanceMode, setPerformanceMode] = useState(true);
  const [recordPreset, setRecordPreset] = useState<RecordPresetKey>("smooth");
  const [recorderMode, setRecorderMode] = useState<RecorderMode>("webm");
  const [stableMp4Supported, setStableMp4Supported] = useState(false);

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const drawFrameRef = useRef<number | null>(null);
  const replayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);

  const selectedPreset = RECORD_PRESETS[recordPreset];

  const onMapReady = useCallback((map: mapboxgl.Map) => {
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const checkStableMp4Support = async () => {
      const hasWebCodecs =
        typeof window !== "undefined" &&
        "VideoEncoder" in window &&
        "VideoFrame" in window;
      if (!hasWebCodecs) {
        setStableMp4Supported(false);
        setRecorderMode("webm");
        return;
      }

      const probe = await VideoEncoder.isConfigSupported({
        codec: "avc1.42001f",
        width: 1280,
        height: 720,
        bitrate: 8_000_000,
        framerate: 30,
        hardwareAcceleration: "prefer-hardware",
      }).catch(() => null);
      const supported = !!probe?.supported;
      setStableMp4Supported(supported);
      if (!supported) setRecorderMode("webm");
    };
    void checkStableMp4Support();
  }, []);

  const setInteractionsEnabled = useCallback((map: mapboxgl.Map, enabled: boolean) => {
    const method = enabled ? "enable" : "disable";
    map.dragPan?.[method]();
    map.scrollZoom?.[method]();
    map.boxZoom?.[method]();
    map.doubleClickZoom?.[method]();
    map.touchZoomRotate?.[method]();
    map.keyboard?.[method]();
  }, []);

  const startReplayWithLeadIn = useCallback(() => {
    replayTimeoutRef.current = setTimeout(() => {
      setReplayTrigger((t) => t + 1);
      replayTimeoutRef.current = null;
    }, RECORD_LEAD_IN_MS);
  }, []);

  const downloadBlob = useCallback((blob: Blob, extension: "mp4" | "webm") => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `travel-map-${Date.now()}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const finishRecording = useCallback(() => {
    if (drawFrameRef.current != null) {
      cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }
    if (replayTimeoutRef.current != null) {
      clearTimeout(replayTimeoutRef.current);
      replayTimeoutRef.current = null;
    }
    stopRecordingRef.current = null;
    const map = mapRef.current;
    if (map) setInteractionsEnabled(map, true);
  }, [setInteractionsEnabled]);

  const onSequenceComplete = useCallback(() => {
    stopRecordingRef.current?.();
  }, []);

  useEffect(() => {
    return () => {
      stopRecordingRef.current?.();
      finishRecording();
    };
  }, [finishRecording]);

  const token =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN
      : undefined;

  const resolveVideoEncoderConfig = useCallback(
    async (width: number, height: number, fps: number, bitrate: number) => {
      if (typeof window === "undefined" || !("VideoEncoder" in window)) return null;
      const candidates = [
        "avc1.42001f",
        "avc1.4d401f",
      ];
      for (const codec of candidates) {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate,
          framerate: fps,
          hardwareAcceleration: "prefer-hardware",
        }).catch(() => null);
        if (support?.supported) return support.config;
      }
      return null;
    },
    []
  );

  const startWebmRecorder = useCallback(
    (
      map: mapboxgl.Map,
      sourceCanvas: HTMLCanvasElement,
      fps: number,
      bitrate: number
    ) => {
      const stream = sourceCanvas.captureStream(fps);
      recordingStreamRef.current = stream;

      const options: MediaRecorderOptions = { videoBitsPerSecond: bitrate };
      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
        options.mimeType = "video/webm;codecs=vp9";
      } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        options.mimeType = "video/webm;codecs=vp8";
      }

      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: options.mimeType ?? "video/webm" });
        downloadBlob(blob, "webm");
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        finishRecording();
      };
      recorderRef.current = recorder;
      stopRecordingRef.current = () => {
        const active = recorderRef.current;
        if (active && active.state === "recording") active.stop();
      };
      setInteractionsEnabled(map, false);
      recorder.start(100);
      setRecording(true);
      startReplayWithLeadIn();
      return true;
    },
    [downloadBlob, finishRecording, setInteractionsEnabled, startReplayWithLeadIn]
  );

  const startStableMp4Recorder = useCallback(
    async (
      map: mapboxgl.Map,
      sourceCanvas: HTMLCanvasElement,
      width: number,
      height: number,
      fps: number,
      bitrate: number
    ) => {
      if (!stableMp4Supported) return false;
      const muxerModule = await import("mp4-muxer").catch(() => null);
      if (!muxerModule) return false;
      const { ArrayBufferTarget, Muxer } = muxerModule;
      const encoderConfig = await resolveVideoEncoderConfig(width, height, fps, bitrate);
      if (!encoderConfig) return false;

      const stagingCanvas = document.createElement("canvas");
      stagingCanvas.width = width;
      stagingCanvas.height = height;
      const stagingCtx = stagingCanvas.getContext("2d", { alpha: false });
      if (!stagingCtx) return false;

      const codec = encoderConfig.codec;
      const muxerCodec: "avc" | "vp9" | "av1" =
        codec.startsWith("avc1") ? "avc" : codec.startsWith("vp09") ? "vp9" : "av1";
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        fastStart: "in-memory",
        video: {
          codec: muxerCodec,
          width,
          height,
          frameRate: fps,
        },
      });

      let finalized = false;
      let encoderErrored = false;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta);
        },
        error: () => {
          encoderErrored = true;
        },
      });
      encoder.configure({
        ...encoderConfig,
        width,
        height,
        bitrate,
        framerate: fps,
      });

      const stopStableRecorder = async () => {
        if (finalized) return;
        finalized = true;
        if (drawFrameRef.current != null) {
          cancelAnimationFrame(drawFrameRef.current);
          drawFrameRef.current = null;
        }
        try {
          await encoder.flush();
        } catch {
          encoderErrored = true;
        }
        try {
          encoder.close();
        } catch {
          // no-op
        }
        if (!encoderErrored) {
          muxer.finalize();
          downloadBlob(new Blob([target.buffer], { type: "video/mp4" }), "mp4");
        } else {
          setError("Stable MP4 export failed. Try WebM mode.");
        }
        setRecording(false);
        finishRecording();
      };

      const frameDurationMs = 1000 / fps;
      const frameDurationUs = Math.round(1_000_000 / fps);
      let nextCaptureAt = performance.now();
      let frameIndex = 0;
      const encode = (now: number) => {
        if (finalized) return;
        if (now >= nextCaptureAt) {
          stagingCtx.drawImage(sourceCanvas, 0, 0, width, height);
          const frame = new VideoFrame(stagingCanvas, {
            timestamp: frameIndex * frameDurationUs,
            duration: frameDurationUs,
          });
          encoder.encode(frame, { keyFrame: frameIndex % fps === 0 });
          frame.close();
          frameIndex += 1;
          nextCaptureAt += frameDurationMs;
          if (now > nextCaptureAt + frameDurationMs * 2) {
            nextCaptureAt = now + frameDurationMs;
          }
        }
        drawFrameRef.current = requestAnimationFrame(encode);
      };

      stopRecordingRef.current = () => {
        void stopStableRecorder();
      };
      setInteractionsEnabled(map, false);
      setRecording(true);
      drawFrameRef.current = requestAnimationFrame(encode);
      startReplayWithLeadIn();
      return true;
    },
    [
      downloadBlob,
      finishRecording,
      resolveVideoEncoderConfig,
      setInteractionsEnabled,
      stableMp4Supported,
      startReplayWithLeadIn,
      setError,
    ]
  );

  async function handleRecord() {
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
    finishRecording();
    const sourceCanvas = map.getCanvas();
    const { fps, bitrate } = selectedPreset;

    if (recorderMode === "stable-mp4") {
      const started = await startStableMp4Recorder(
        map,
        sourceCanvas,
        selectedPreset.width,
        selectedPreset.height,
        fps,
        bitrate
      );
      if (started) return;
      setError("Stable MP4 is unavailable on this browser. Falling back to WebM.");
    }

    startWebmRecorder(map, sourceCanvas, fps, bitrate);
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
    } catch {
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

        <div className="mb-6">
          <label
            htmlFor="recorder-mode"
            className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Recorder mode
          </label>
          <select
            id="recorder-mode"
            value={recorderMode}
            onChange={(e) => setRecorderMode(e.target.value as RecorderMode)}
            disabled={recording}
            className="mb-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="stable-mp4" disabled={!stableMp4Supported}>
              Stable MP4 (WebCodecs)
            </option>
            <option value="webm">WebM (Compatibility)</option>
          </select>

          <label
            htmlFor="record-preset"
            className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Recording preset
          </label>
          <select
            id="record-preset"
            value={recordPreset}
            onChange={(e) => setRecordPreset(e.target.value as RecordPresetKey)}
            disabled={recording}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="smooth">{RECORD_PRESETS.smooth.label}</option>
            <option value="quality">{RECORD_PRESETS.quality.label}</option>
          </select>
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
                min="0.6"
                max="1.6"
                step="0.05"
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
                max="9000"
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
          <div className="sm:col-span-2">
            <label className="flex items-center gap-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={performanceMode}
                onChange={(e) => setPerformanceMode(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700"
              />
              Performance mode (disable terrain/sky)
            </label>
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
          performanceMode={performanceMode}
          fixedFps={recording ? selectedPreset.fps : null}
        />
      </div>
    </main>
  );
}
