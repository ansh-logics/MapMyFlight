"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as turf from "@turf/turf";
import Map from "@/components/Map";
import {
  DEFAULT_TIMINGS,
  MAP_THEMES,
  type AspectRatio,
  type ExportFormat,
  type FrameRate,
  type MapTheme,
  type RenderProgress,
  type RenderSpecV1,
  type RoutePoint,
} from "@/lib/render-spec";
import {
  BrowserRenderProvider,
  downloadRender,
} from "@/lib/local-render-provider";

const MAPBOX_GEOCODE = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const provider = new BrowserRenderProvider();

type Step = "route" | "style" | "export";

async function geocode(query: string, token: string): Promise<RoutePoint | null> {
  if (!query.trim()) return null;
  const url = `${MAPBOX_GEOCODE}/${encodeURIComponent(query.trim())}.json?access_token=${token}&limit=1`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  const center = data.features?.[0]?.center;
  return Array.isArray(center) && center.length >= 2 ? [center[0], center[1]] : null;
}

function Icon({
  name,
  size = 18,
}: {
  name: "pin" | "sparkles" | "export" | "play" | "check" | "film" | "route";
  size?: number;
}) {
  const paths = {
    pin: <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" /><path d="m5 13 .8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" /><path d="m19 14 .7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14Z" /></>,
    export: <><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 13v7h14v-7" /></>,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" /></>,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18c7 0 1-12 8-12" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function StepButton({
  active,
  complete,
  label,
  number,
  onClick,
}: {
  active: boolean;
  complete: boolean;
  label: string;
  number: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`step-button ${active ? "is-active" : ""} ${complete ? "is-complete" : ""}`}
      onClick={onClick}
    >
      <span>{complete ? <Icon name="check" size={14} /> : number}</span>
      {label}
    </button>
  );
}

export default function Home() {
  const [activeStep, setActiveStep] = useState<Step>("route");
  const [from, setFrom] = useState("Delhi");
  const [to, setTo] = useState("Tokyo");
  const [coordinates, setCoordinates] = useState<{ from: RoutePoint; to: RoutePoint } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [theme, setTheme] = useState<MapTheme>("midnight");
  const [routeColor, setRouteColor] = useState("#E0B36A");
  const [vehicleColor, setVehicleColor] = useState("#F5E8D0");
  const [accentColor, setAccentColor] = useState("#E0B36A");
  const [routeWidth, setRouteWidth] = useState(4);
  const [vehicleScale, setVehicleScale] = useState(0.78);
  const [flightMs, setFlightMs] = useState(6000);
  const [title, setTitle] = useState("Across the world");
  const [subtitle, setSubtitle] = useState("One route. A thousand memories.");
  const [outroTitle, setOutroTitle] = useState("The journey continues");
  const [brand, setBrand] = useState("Travel Story");
  const [frameRate, setFrameRate] = useState<FrameRate>(30);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [mp4Supported, setMp4Supported] = useState(false);
  const [replayTrigger, setReplayTrigger] = useState(0);
  const [progress, setProgress] = useState<RenderProgress>({
    phase: "idle",
    progress: 0,
    message: "Ready to export",
  });
  const abortRef = useRef<AbortController | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const exporting = ["preparing", "loading-assets", "encoding", "muxing"].includes(progress.phase);

  useEffect(() => {
    const detect = async () => {
      if (!("VideoEncoder" in window)) {
        setMp4Supported(false);
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
    if (!coordinates) return null;
    const distanceKm = turf.distance(
      turf.point(coordinates.from),
      turf.point(coordinates.to),
      { units: "kilometers" }
    );
    return {
      version: 1,
      route: {
        from: { name: from.trim(), coordinates: coordinates.from },
        to: { name: to.trim(), coordinates: coordinates.to },
        distanceKm,
      },
      aspectRatio,
      quality: "1080p",
      frameRate,
      timings: { ...DEFAULT_TIMINGS, flightMs },
      map: {
        theme,
        styleUrl: MAP_THEMES[theme].styleUrl,
        cameraPreset: "cinematic",
      },
      appearance: {
        routeColor,
        routeWidth,
        vehicle: "plane",
        vehicleColor,
        vehicleScale,
        accentColor,
        fontFamily: "Geist",
      },
      story: { title, subtitle, outroTitle, brand },
    };
  }, [
    coordinates, from, to, aspectRatio, frameRate, flightMs, theme, routeColor,
    routeWidth, vehicleColor, vehicleScale, accentColor, title, subtitle, outroTitle, brand,
  ]);

  async function handleGenerate() {
    setError(null);
    if (!from.trim() || !to.trim()) {
      setError("Enter both an origin and destination.");
      return;
    }
    if (!token) {
      setError("Mapbox token is missing. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local.");
      return;
    }
    setLoading(true);
    try {
      const [fromCoordinates, toCoordinates] = await Promise.all([
        geocode(from, token),
        geocode(to, token),
      ]);
      if (!fromCoordinates) throw new Error(`We couldn't find “${from}”.`);
      if (!toCoordinates) throw new Error(`We couldn't find “${to}”.`);
      setCoordinates({ from: fromCoordinates, to: toCoordinates });
      setActiveStep("style");
      setReplayTrigger((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create this route.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!spec || exporting) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await provider.renderLocal(spec, {
        format,
        signal: controller.signal,
        onProgress: setProgress,
      });
      downloadRender(result, spec.route.from.name, spec.route.to.name);
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
    if (nextTheme === "midnight") {
      setRouteColor("#E0B36A");
      setAccentColor("#E0B36A");
      setVehicleColor("#F5E8D0");
    } else {
      setRouteColor("#C66345");
      setAccentColor("#C66345");
      setVehicleColor("#243044");
    }
  }

  return (
    <main className="studio-app">
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-brand-mark"><Icon name="route" size={20} /></span>
          <div>
            <strong>WAYFARE</strong>
            <span>Travel video studio</span>
          </div>
        </div>
        <div className="studio-header-status">
          <span className="status-dot" />
          Browser studio
        </div>
      </header>

      <nav className="studio-steps" aria-label="Creation steps">
        <StepButton active={activeStep === "route"} complete={Boolean(spec)} label="Route" number={1} onClick={() => setActiveStep("route")} />
        <span className="step-line" />
        <StepButton active={activeStep === "style"} complete={Boolean(spec) && activeStep === "export"} label="Style" number={2} onClick={() => spec && setActiveStep("style")} />
        <span className="step-line" />
        <StepButton active={activeStep === "export"} complete={progress.phase === "completed"} label="Export" number={3} onClick={() => spec && setActiveStep("export")} />
      </nav>

      <div className="studio-workspace">
        <section className="studio-sidebar">
          {activeStep === "route" && (
            <div className="panel-section">
              <div className="panel-heading">
                <span className="panel-icon"><Icon name="pin" /></span>
                <div><span>Step 01</span><h1>Map your journey</h1></div>
              </div>
              <p className="panel-intro">Set the beginning and destination. We’ll compose the cinematic route.</p>

              <label className="field-label" htmlFor="from">Origin</label>
              <div className="field-with-icon">
                <Icon name="pin" size={17} />
                <input id="from" value={from} onChange={(event) => setFrom(event.target.value)} placeholder="e.g. Delhi" />
              </div>
              <div className="route-connector"><span /><i /><span /></div>
              <label className="field-label" htmlFor="to">Destination</label>
              <div className="field-with-icon">
                <Icon name="pin" size={17} />
                <input id="to" value={to} onChange={(event) => setTo(event.target.value)} placeholder="e.g. Tokyo" />
              </div>
              <button className="primary-action" type="button" onClick={handleGenerate} disabled={loading}>
                <Icon name="sparkles" />
                {loading ? "Crafting your route…" : spec ? "Update journey" : "Create journey"}
              </button>
              <p className="action-hint">Map data provided by Mapbox and OpenStreetMap.</p>
            </div>
          )}

          {activeStep === "style" && spec && (
            <div className="panel-section">
              <div className="panel-heading">
                <span className="panel-icon"><Icon name="sparkles" /></span>
                <div><span>Step 02</span><h1>Direct the story</h1></div>
              </div>
              <p className="panel-intro">Choose a visual world and shape the titles your audience will remember.</p>

              <span className="field-label">Cinematic theme</span>
              <div className="theme-grid">
                {(Object.keys(MAP_THEMES) as MapTheme[]).map((themeKey) => {
                  const item = MAP_THEMES[themeKey];
                  return (
                    <button key={themeKey} type="button" className={`theme-card ${theme === themeKey ? "is-selected" : ""}`} onClick={() => applyTheme(themeKey)}>
                      <span className="theme-swatch">
                        {item.swatches.map((color) => <i key={color} style={{ background: color }} />)}
                      </span>
                      <strong>{item.name}</strong>
                      <small>{item.description}</small>
                      {theme === themeKey && <span className="theme-check"><Icon name="check" size={12} /></span>}
                    </button>
                  );
                })}
              </div>

              <label className="field-label" htmlFor="story-title">Story title</label>
              <input className="studio-input" id="story-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <label className="field-label" htmlFor="story-subtitle">Subtitle</label>
              <input className="studio-input" id="story-subtitle" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />

              <details className="advanced-panel">
                <summary>Advanced styling <span>+</span></summary>
                <div className="advanced-content">
                  <div className="color-row">
                    <label>Route <input type="color" value={routeColor} onChange={(event) => setRouteColor(event.target.value)} /></label>
                    <label>Vehicle <input type="color" value={vehicleColor} onChange={(event) => setVehicleColor(event.target.value)} /></label>
                    <label>Accent <input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></label>
                  </div>
                  <label className="range-label">Route width <span>{routeWidth}px</span></label>
                  <input type="range" min="2" max="8" step="0.5" value={routeWidth} onChange={(event) => setRouteWidth(Number(event.target.value))} />
                  <label className="range-label">Vehicle size <span>{vehicleScale.toFixed(2)}</span></label>
                  <input type="range" min="0.55" max="1.25" step="0.05" value={vehicleScale} onChange={(event) => setVehicleScale(Number(event.target.value))} />
                  <label className="range-label">Flight scene <span>{(flightMs / 1000).toFixed(1)}s</span></label>
                  <input type="range" min="3500" max="9000" step="250" value={flightMs} onChange={(event) => setFlightMs(Number(event.target.value))} />
                  <label className="field-label" htmlFor="outro-title">Outro title</label>
                  <input className="studio-input" id="outro-title" value={outroTitle} onChange={(event) => setOutroTitle(event.target.value)} />
                  <label className="field-label" htmlFor="brand">Brand label</label>
                  <input className="studio-input" id="brand" value={brand} onChange={(event) => setBrand(event.target.value)} />
                </div>
              </details>

              <button className="primary-action" type="button" onClick={() => setActiveStep("export")}>
                Continue to export <span aria-hidden="true">→</span>
              </button>
            </div>
          )}

          {activeStep === "export" && spec && (
            <div className="panel-section">
              <div className="panel-heading">
                <span className="panel-icon"><Icon name="export" /></span>
                <div><span>Step 03</span><h1>Export your film</h1></div>
              </div>
              <p className="panel-intro">Render every frame at its true output resolution for crisp maps, type, and motion.</p>

              <span className="field-label">Quality</span>
              <div className="quality-list">
                <button type="button" className="quality-card is-selected">
                  <span><strong>Full HD</strong><small>True 1080p · Local render</small></span>
                  <b>1920 × 1080</b><i><Icon name="check" size={12} /></i>
                </button>
                <button type="button" className="quality-card" disabled>
                  <span><strong>4K Cloud</strong><small>Premium render provider</small></span>
                  <b>Coming next</b><em>Cloud</em>
                </button>
              </div>

              <div className="export-options">
                <div>
                  <label className="field-label" htmlFor="fps">Frame rate</label>
                  <select id="fps" value={frameRate} onChange={(event) => setFrameRate(Number(event.target.value) as FrameRate)} disabled={exporting}>
                    <option value="30">30 fps · Smooth</option>
                    <option value="60">60 fps · Ultra smooth</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="format">Format</label>
                  <select id="format" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} disabled={exporting}>
                    <option value="mp4" disabled={!mp4Supported}>MP4 · Premium</option>
                    <option value="webm">WebM · Compatible</option>
                  </select>
                </div>
              </div>

              <div className={`render-status ${exporting ? "is-rendering" : ""}`}>
                <div className="render-status-row">
                  <span><Icon name="film" size={16} /> {progress.message}</span>
                  <strong>{Math.round(progress.progress * 100)}%</strong>
                </div>
                <div className="progress-track"><i style={{ width: `${progress.progress * 100}%` }} /></div>
              </div>

              {exporting ? (
                <button className="secondary-action" type="button" onClick={() => abortRef.current?.abort()}>Cancel export</button>
              ) : (
                <button className="primary-action export-action" type="button" onClick={handleExport}>
                  <Icon name="export" /> Export {format.toUpperCase()} in 1080p
                </button>
              )}
              {!mp4Supported && <p className="action-hint">This browser does not expose H.264 WebCodecs, so the compatibility WebM renderer is selected.</p>}
            </div>
          )}

          {error && <div className="studio-error" role="alert">{error}</div>}
        </section>

        <section className="preview-workspace">
          <div className="preview-toolbar">
            <div>
              <span className="preview-kicker">Live composition</span>
              <strong>{spec ? `${spec.route.from.name} → ${spec.route.to.name}` : "Untitled journey"}</strong>
            </div>
            <div className="preview-actions">
              <div className="ratio-toggle" aria-label="Video aspect ratio">
                <button type="button" className={aspectRatio === "16:9" ? "is-active" : ""} onClick={() => setAspectRatio("16:9")}>16:9</button>
                <button type="button" className={aspectRatio === "9:16" ? "is-active" : ""} onClick={() => setAspectRatio("9:16")}>9:16</button>
              </div>
              <button type="button" className="replay-button" onClick={() => setReplayTrigger((value) => value + 1)} disabled={!spec}>
                <Icon name="play" size={15} /> Replay
              </button>
            </div>
          </div>

          <div className={`preview-stage ratio-${aspectRatio.replace(":", "-")}`}>
            <Map spec={spec} replayTrigger={replayTrigger} />
          </div>
          <div className="preview-note">
            <span><i /> Preview quality</span>
            <p>Exports use a separate full-resolution 1080p render stage.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
