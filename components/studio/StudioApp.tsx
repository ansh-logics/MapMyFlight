"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as turf from "@turf/turf";
import Map from "@/components/Map";
import Icon, { type IconName } from "@/components/ui/Icon";
import { LogoMark } from "@/components/ui/Logo";
import PlaceField, { searchPlaces, type Place } from "@/components/studio/PlaceField";
import {
  DEFAULT_TIMINGS,
  MAP_THEMES,
  getOutputSize,
  getTotalDuration,
  type AspectRatio,
  type ExportFormat,
  type FrameRate,
  type MapTheme,
  type RenderProgress,
  type RenderSpecV1,
  type RoutePoint,
} from "@/lib/render-spec";
import { BrowserRenderProvider, downloadRender } from "@/lib/local-render-provider";
import "@/app/studio/studio.css";

const provider = new BrowserRenderProvider();

type Tab = "route" | "style" | "export";
type SelectedPlace = { name: string; coordinates: RoutePoint } | null;

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "route", label: "Route", icon: "route" },
  { id: "style", label: "Style", icon: "palette" },
  { id: "export", label: "Export", icon: "export" },
];

const THEME_COLORS: Record<MapTheme, { route: string; accent: string; vehicle: string }> = {
  midnight: { route: "#E0B36A", accent: "#E0B36A", vehicle: "#F5E8D0" },
  paper: { route: "#C66345", accent: "#C66345", vehicle: "#243044" },
};

/** Uses the coordinates picked from suggestions; otherwise looks the text up. */
async function resolvePlace(query: string, selected: SelectedPlace, token: string) {
  if (selected && selected.name === query.trim()) return selected.coordinates;
  const [match] = await searchPlaces(query, token, 1);
  return match?.coordinates ?? null;
}

export default function StudioApp() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>("route");
  const [from, setFrom] = useState(() => searchParams.get("from") ?? "Delhi");
  const [to, setTo] = useState(() => searchParams.get("to") ?? "Tokyo");
  const [fromPlace, setFromPlace] = useState<SelectedPlace>(null);
  const [toPlace, setToPlace] = useState<SelectedPlace>(null);
  const [route, setRoute] = useState<{ from: string; to: string; fromPoint: RoutePoint; toPoint: RoutePoint } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [theme, setTheme] = useState<MapTheme>("midnight");
  const [routeColor, setRouteColor] = useState(THEME_COLORS.midnight.route);
  const [vehicleColor, setVehicleColor] = useState(THEME_COLORS.midnight.vehicle);
  const [accentColor, setAccentColor] = useState(THEME_COLORS.midnight.accent);
  const [routeWidth, setRouteWidth] = useState(4);
  const [vehicleScale, setVehicleScale] = useState(0.78);
  const [flightMs, setFlightMs] = useState(DEFAULT_TIMINGS.flightMs);
  const [frameRate] = useState<FrameRate>(30);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [mp4Supported, setMp4Supported] = useState(false);
  const [replayTrigger, setReplayTrigger] = useState(0);
  const [progress, setProgress] = useState<RenderProgress>({ phase: "idle", progress: 0, message: "Ready to export" });
  const abortRef = useRef<AbortController | null>(null);
  const playheadRef = useRef<HTMLSpanElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const autoStartedRef = useRef(false);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const exporting = ["preparing", "loading-assets", "encoding", "muxing"].includes(progress.phase);

  useEffect(() => {
    const detect = async () => {
      if (!("VideoEncoder" in window)) {
        setFormat("webm");
        return;
      }
      const support = await VideoEncoder.isConfigSupported({
        codec: "avc1.4d4028",
        width: 1920,
        height: 1080,
        framerate: 30,
        bitrate: 18_000_000,
      }).catch(() => null);
      setMp4Supported(Boolean(support?.supported));
      if (!support?.supported) setFormat("webm");
    };
    void detect();
    return () => abortRef.current?.abort();
  }, []);

  const spec = useMemo<RenderSpecV1 | null>(() => {
    if (!route) return null;
    return {
      version: 1,
      route: {
        from: { name: route.from, coordinates: route.fromPoint },
        to: { name: route.to, coordinates: route.toPoint },
        distanceKm: turf.distance(turf.point(route.fromPoint), turf.point(route.toPoint), { units: "kilometers" }),
      },
      aspectRatio,
      quality: "1080p",
      frameRate,
      timings: { ...DEFAULT_TIMINGS, flightMs },
      map: { theme, styleUrl: MAP_THEMES[theme].styleUrl, cameraPreset: "cinematic" },
      appearance: {
        routeColor,
        routeWidth,
        vehicle: "plane",
        vehicleColor,
        vehicleScale,
        accentColor,
        fontFamily: "Geist",
      },
      story: { title: "", subtitle: "", outroTitle: "", brand: "MapMyFlight" },
    };
  }, [route, aspectRatio, frameRate, flightMs, theme, routeColor, routeWidth, vehicleColor, vehicleScale, accentColor]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (!from.trim() || !to.trim()) {
      setError("Enter both an origin and a destination.");
      return;
    }
    if (!token) {
      setError("Mapbox token is missing. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.");
      return;
    }
    setLoading(true);
    try {
      const [fromPoint, toPoint] = await Promise.all([
        resolvePlace(from, fromPlace, token),
        resolvePlace(to, toPlace, token),
      ]);
      if (!fromPoint) throw new Error(`We couldn't find “${from}”.`);
      if (!toPoint) throw new Error(`We couldn't find “${to}”.`);
      setRoute({ from: from.trim(), to: to.trim(), fromPoint, toPoint });
      setActiveTab("style");
      setReplayTrigger((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create this route.");
    } finally {
      setLoading(false);
    }
  }, [from, to, fromPlace, toPlace, token]);

  // Arriving from the landing page with ?from=&to= composes the film straight away.
  useEffect(() => {
    if (autoStartedRef.current || !token) return;
    if (!searchParams.get("from") || !searchParams.get("to")) return;
    autoStartedRef.current = true;
    void handleGenerate();
  }, [handleGenerate, searchParams, token]);

  async function handleExport() {
    if (!spec || exporting) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await provider.renderLocal(spec, { format, signal: controller.signal, onProgress: setProgress });
      downloadRender(result, spec.route.from.name, spec.route.to.name);
      setReplayTrigger((value) => value + 1);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "The export could not be completed.");
      }
    } finally {
      abortRef.current = null;
    }
  }

  function applyTheme(nextTheme: MapTheme) {
    setTheme(nextTheme);
    setRouteColor(THEME_COLORS[nextTheme].route);
    setAccentColor(THEME_COLORS[nextTheme].accent);
    setVehicleColor(THEME_COLORS[nextTheme].vehicle);
  }

  function swapPlaces() {
    setFrom(to);
    setTo(from);
    setFromPlace(toPlace);
    setToPlace(fromPlace);
  }

  function openTab(tab: Tab) {
    if (tab !== "route" && !spec) return;
    setActiveTab(tab);
    if (window.matchMedia("(max-width: 959px)").matches) {
      inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Arrow keys move between tabs, as the ARIA tabs pattern expects.
  function handleTabKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const enabled = TABS.filter((tab) => tab.id === "route" || spec);
    const index = enabled.findIndex((tab) => tab.id === activeTab);
    const next = enabled[(index + (event.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
    setActiveTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  const handleProgress = useCallback((value: number) => {
    if (playheadRef.current) playheadRef.current.style.left = `${value * 100}%`;
  }, []);

  const timings = { ...DEFAULT_TIMINGS, flightMs };
  const totalMs = getTotalDuration(timings);
  const scenes = [
    { label: "Intro", ms: timings.introMs },
    { label: "Departure", ms: timings.originHoldMs },
    { label: "Flight", ms: timings.flightMs },
    { label: "Arrival", ms: timings.destinationHoldMs },
    { label: "Outro", ms: timings.outroMs },
  ];
  const output = getOutputSize(aspectRatio, "1080p");
  const distance = spec ? `${Math.round(spec.route.distanceKm).toLocaleString("en-US")} km` : null;

  return (
    <div className="studio">
      <header className="studio-bar">
        <div className="studio-bar-left">
          <Link href="/" className="studio-logo" aria-label="MapMyFlight home">
            <LogoMark />
            <span>MapMy<em>Flight</em></span>
          </Link>
          <span className="studio-bar-divider" aria-hidden="true" />
          <div className="studio-project">
            <strong>
              {spec ? <>{spec.route.from.name} <i>→</i> {spec.route.to.name}</> : "Untitled journey"}
            </strong>
            <span>{distance ? `${distance} · ${(totalMs / 1000).toFixed(1)}s film` : "Draft"}</span>
          </div>
        </div>
        <div className="studio-bar-right">
          <div className="segmented" role="group" aria-label="Video aspect ratio">
            {(["16:9", "9:16"] as AspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                aria-pressed={aspectRatio === ratio}
                className={aspectRatio === ratio ? "is-active" : ""}
                onClick={() => setAspectRatio(ratio)}
                disabled={exporting}
              >
                <span className={`ratio-glyph ratio-glyph-${ratio === "16:9" ? "wide" : "tall"}`} aria-hidden="true" />
                {ratio}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm studio-bar-icon"
            onClick={() => setReplayTrigger((value) => value + 1)}
            disabled={!spec || exporting}
            aria-label="Replay preview"
          >
            <Icon name="replay" size={15} /> <span>Replay</span>
          </button>
          <button
            type="button"
            className="btn btn-gold btn-sm studio-bar-icon"
            onClick={() => openTab("export")}
            disabled={!spec}
            aria-label="Export film"
          >
            <Icon name="export" size={15} /> <span>Export</span>
          </button>
        </div>
      </header>

      <div className="studio-body">
        <section className="studio-stage" aria-label="Preview">
          <div className="stage-canvas">
            <div className={`preview-frame ratio-${aspectRatio.replace(":", "-")}`}>
              <Map spec={spec} replayTrigger={replayTrigger} onProgress={handleProgress} />
            </div>
          </div>

          <div className={`scene-strip ${spec ? "" : "is-empty"}`} aria-label="Scene timeline">
            <div className="scene-strip-track">
              {scenes.map((scene) => (
                <div key={scene.label} className="scene-strip-item" style={{ flexGrow: scene.ms }}>
                  <span>{scene.label}</span>
                  <small>{(scene.ms / 1000).toFixed(1)}s</small>
                </div>
              ))}
              <span ref={playheadRef} className="scene-strip-playhead" aria-hidden="true" />
            </div>
            <p className="scene-strip-note">
              <i aria-hidden="true" /> Live preview · the export renders every frame separately at full {output.width} × {output.height}
            </p>
          </div>
        </section>

        <aside className="inspector" ref={inspectorRef} aria-label="Inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Editor sections" onKeyDown={handleTabKey}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={activeTab === tab.id ? "is-active" : ""}
                disabled={tab.id !== "route" && !spec}
                onClick={() => openTab(tab.id)}
              >
                <Icon name={tab.icon} size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inspector-body">
            {activeTab === "route" && (
              <div className="inspector-panel" role="tabpanel" id="panel-route" aria-labelledby="tab-route">
                <PanelHeading kicker="Scene 01" title="Map your journey" body="Set where it begins and where it lands. We'll compose the cinematic route between them." />
                <div className="route-fields">
                  <PlaceField
                    label="Origin"
                    marker="origin"
                    value={from}
                    placeholder="e.g. Delhi"
                    token={token}
                    onChange={(value) => {
                      setFrom(value);
                      if (fromPlace && fromPlace.name !== value) setFromPlace(null);
                    }}
                    onSelect={(place: Place) => setFromPlace({ name: place.name, coordinates: place.coordinates })}
                    onSubmit={handleGenerate}
                  />
                  <button type="button" className="route-swap" onClick={swapPlaces} aria-label="Swap origin and destination">
                    <Icon name="swap" size={15} />
                  </button>
                  <PlaceField
                    label="Destination"
                    marker="destination"
                    value={to}
                    placeholder="e.g. Tokyo"
                    token={token}
                    onChange={(value) => {
                      setTo(value);
                      if (toPlace && toPlace.name !== value) setToPlace(null);
                    }}
                    onSelect={(place: Place) => setToPlace({ name: place.name, coordinates: place.coordinates })}
                    onSubmit={handleGenerate}
                  />
                </div>
                <button className="btn btn-gold btn-block" type="button" onClick={handleGenerate} disabled={loading}>
                  <Icon name={loading ? "spinner" : "spark"} className={loading ? "spin" : undefined} />
                  {loading ? "Composing your route…" : spec ? "Update journey" : "Create journey"}
                </button>
                <p className="inspector-hint">Place search by Mapbox · Map data © OpenStreetMap</p>
              </div>
            )}

            {activeTab === "style" && spec && (
              <div className="inspector-panel" role="tabpanel" id="panel-style" aria-labelledby="tab-style">
                <PanelHeading kicker="Scene 02" title="Direct the look" body="Choose a cartographic world, then fine-tune the colours and pacing of the flight." />

                <span className="field-label">Cartographic world</span>
                <div className="theme-options">
                  {(Object.keys(MAP_THEMES) as MapTheme[]).map((key) => {
                    const item = MAP_THEMES[key];
                    const selected = theme === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected}
                        className={`theme-option ${selected ? "is-selected" : ""}`}
                        onClick={() => applyTheme(key)}
                      >
                        <span className="theme-option-art">
                          {item.swatches.map((color) => <i key={color} style={{ background: color }} />)}
                        </span>
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                        {selected && <span className="theme-option-check"><Icon name="check" size={12} /></span>}
                      </button>
                    );
                  })}
                </div>

                <span className="field-label">Colours</span>
                <div className="color-grid">
                  <ColorControl label="Route" value={routeColor} onChange={setRouteColor} />
                  <ColorControl label="Aircraft" value={vehicleColor} onChange={setVehicleColor} />
                  <ColorControl label="Accent" value={accentColor} onChange={setAccentColor} />
                </div>

                <span className="field-label">Motion</span>
                <div className="slider-stack">
                  <SliderControl label="Route width" value={routeWidth} display={`${routeWidth}px`} min={2} max={8} step={0.5} onChange={setRouteWidth} />
                  <SliderControl label="Aircraft size" value={vehicleScale} display={`${Math.round(vehicleScale * 100)}%`} min={0.55} max={1.25} step={0.05} onChange={setVehicleScale} />
                  <SliderControl label="Flight scene" value={flightMs} display={`${(flightMs / 1000).toFixed(1)}s`} min={3500} max={9000} step={250} onChange={setFlightMs} />
                </div>

                <button className="btn btn-gold btn-block" type="button" onClick={() => openTab("export")}>
                  Continue to export <Icon name="arrow" size={16} />
                </button>
              </div>
            )}

            {activeTab === "export" && spec && (
              <div className="inspector-panel" role="tabpanel" id="panel-export" aria-labelledby="tab-export">
                <PanelHeading kicker="Scene 03" title="Export your film" body="Every frame is rendered at its true output resolution, so routes, type and terrain stay crisp." />

                <dl className="export-summary">
                  <div><dt>Resolution</dt><dd>{output.width} × {output.height}</dd></div>
                  <div><dt>Frame rate</dt><dd>{frameRate} fps</dd></div>
                  <div><dt>Duration</dt><dd>{(totalMs / 1000).toFixed(1)}s</dd></div>
                  <div><dt>Rendered</dt><dd>On this device</dd></div>
                </dl>

                <span className="field-label" id="format-label">Format</span>
                <div className="format-options" role="radiogroup" aria-labelledby="format-label">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={format === "mp4"}
                    className={`format-option ${format === "mp4" ? "is-selected" : ""}`}
                    onClick={() => setFormat("mp4")}
                    disabled={!mp4Supported || exporting}
                  >
                    <strong>MP4</strong>
                    <small>{mp4Supported ? "H.264 · plays everywhere" : "Not available in this browser"}</small>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={format === "webm"}
                    className={`format-option ${format === "webm" ? "is-selected" : ""}`}
                    onClick={() => setFormat("webm")}
                    disabled={exporting}
                  >
                    <strong>WebM</strong>
                    <small>VP9 · broad browser support</small>
                  </button>
                </div>

                <div
                  className={`render-card ${exporting ? "is-rendering" : ""} ${progress.phase === "completed" ? "is-done" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="render-card-row">
                    <span><Icon name={progress.phase === "completed" ? "check" : "film"} size={16} /> {progress.message}</span>
                    <strong>{Math.round(progress.progress * 100)}%</strong>
                  </div>
                  <div className="render-card-track"><i style={{ transform: `scaleX(${progress.progress})` }} /></div>
                </div>

                {exporting ? (
                  <button className="btn btn-ghost btn-block" type="button" onClick={() => abortRef.current?.abort()}>
                    Cancel export
                  </button>
                ) : (
                  <button className="btn btn-gold btn-block" type="button" onClick={handleExport}>
                    <Icon name="export" /> Export {format.toUpperCase()} · {output.height === 1080 ? "1080p" : "1080 × 1920"}
                  </button>
                )}
                {!mp4Supported && (
                  <p className="inspector-hint">This browser doesn&apos;t offer H.264 encoding, so WebM is selected. Recent Chrome or Edge can export MP4.</p>
                )}
              </div>
            )}

            {error && <div className="studio-error" role="alert">{error}</div>}
          </div>

          <footer className="inspector-footer">Made with care by Ansh</footer>
        </aside>
      </div>
    </div>
  );
}

function PanelHeading({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="panel-heading">
      <span className="panel-kicker">{kicker}</span>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="color-control">
      <span className="color-control-swatch" style={{ background: value }}>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} colour`} />
      </span>
      <span className="color-control-text">
        <strong>{label}</strong>
        <small>{value.toUpperCase()}</small>
      </span>
    </label>
  );
}

function SliderControl({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider-control">
      <span className="slider-control-row">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
