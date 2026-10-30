"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { gsap, MOTION_QUERIES, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import RouteComposer from "@/components/landing/RouteComposer";
import Icon from "@/components/ui/Icon";
import {
  DEFAULT_TIMINGS,
  MAP_THEMES,
  getTotalDuration,
  type AspectRatio,
  type RenderSpecV1,
} from "@/lib/render-spec";
import { createGreatCircle } from "@/lib/route-geometry";
import { evaluateTimeline } from "@/lib/timeline";
import { getCinematicCameraPose, type OverviewCamera } from "@/lib/cinematic-camera";
import { drawFlightOverlay, flightAltitude } from "@/lib/flight-graphics";
import { installFlightScene, setRouteProgress } from "@/lib/flight-scene";

// The hero is the studio's own engine rendered live and driven by scroll
// instead of a clock, so it's sharp at any resolution and matches exports.
const TOTAL = getTotalDuration(DEFAULT_TIMINGS);
const HERO_SPEC: Omit<RenderSpecV1, "aspectRatio"> = {
  version: 1,
  route: {
    from: { name: "Delhi", coordinates: [77.209, 28.6139] },
    to: { name: "Tokyo", coordinates: [139.6917, 35.6895] },
    distanceKm: 5837,
  },
  quality: "1080p",
  frameRate: 30,
  timings: DEFAULT_TIMINGS,
  map: { theme: "midnight", styleUrl: MAP_THEMES.midnight.styleUrl, cameraPreset: "cinematic" },
  appearance: {
    routeColor: "#E0B36A",
    routeWidth: 4,
    vehicle: "plane",
    vehicleColor: "#F5E8D0",
    vehicleScale: 0.78,
    accentColor: "#E0B36A",
    fontFamily: "Geist",
  },
  story: { title: "", subtitle: "", outroTitle: "", brand: "MapMyFlight" },
};
const ROUTE = createGreatCircle(HERO_SPEC.route.from.coordinates, HERO_SPEC.route.to.coordinates);
const CRUISE_FT = 37000;

const T = {
  originStart: DEFAULT_TIMINGS.introMs / TOTAL,
  flightStart: (DEFAULT_TIMINGS.introMs + DEFAULT_TIMINGS.originHoldMs) / TOTAL,
  flightEnd: (DEFAULT_TIMINGS.introMs + DEFAULT_TIMINGS.originHoldMs + DEFAULT_TIMINGS.flightMs) / TOTAL,
  outroStart: (TOTAL - DEFAULT_TIMINGS.outroMs) / TOTAL,
};

const SCENES = [
  { label: "Intro", start: 0, end: T.originStart },
  { label: "Departure", start: T.originStart, end: T.flightStart },
  { label: "Flight", start: T.flightStart, end: T.flightEnd },
  { label: "Arrival", start: T.flightEnd, end: T.outroStart },
  { label: "Outro", start: T.outroStart, end: 1 },
];

function formatTimecode(progress: number) {
  const frames = Math.round(progress * (TOTAL / 1000) * 30);
  const seconds = Math.floor(frames / 30);
  return `00:00:${String(seconds).padStart(2, "0")}:${String(frames % 30).padStart(2, "0")}`;
}

export default function HeroFlight() {
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const distanceRef = useRef<HTMLSpanElement>(null);
  const altitudeRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const progressRef = useRef(0);
  const [ready, setReady] = useState(false);

  // Live Mapbox scene. Skipped under reduced motion (a still poster shows
  // instead), so those visitors never load the map at all.
  useEffect(() => {
    const container = mapRef.current;
    const overlay = overlayRef.current;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!container || !overlay || !token) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let map: mapboxgl.Map | null = null;
    let disposed = false;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let removePointer: (() => void) | null = null;
    // Pointer parallax: the camera leans a few degrees toward the cursor.
    const lean = { x: 0, y: 0, targetX: 0, targetY: 0 };

    const start = async () => {
      const mapbox = (await import("mapbox-gl")).default;
      if (disposed) return;
      mapbox.accessToken = token;

      const aspectNow = (): AspectRatio => (container.clientWidth / container.clientHeight < 0.9 ? "9:16" : "16:9");
      let spec: RenderSpecV1 = { ...HERO_SPEC, aspectRatio: aspectNow() };
      let overview: OverviewCamera | null = null;

      const activeMap = new mapbox.Map({
        container,
        style: spec.map.styleUrl,
        center: spec.route.from.coordinates,
        zoom: 2,
        projection: "mercator",
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      map = activeMap;
      activeMap.addControl(new mapbox.AttributionControl({ compact: true }), "bottom-right");

      // Same framing as the exporter: fit the whole route with breathing room.
      const computeOverview = () => {
        spec = { ...spec, aspectRatio: aspectNow() };
        const w = container.clientWidth;
        const h = container.clientHeight;
        const bounds = ROUTE.reduce(
          (result, point) => result.extend(point),
          new mapbox.LngLatBounds(ROUTE[0], ROUTE[0])
        );
        const camera = activeMap.cameraForBounds(bounds, {
          padding: spec.aspectRatio === "9:16"
            ? { top: h * 0.25, right: w * 0.08, bottom: h * 0.26, left: w * 0.08 }
            : { top: h * 0.18, right: w * 0.08, bottom: h * 0.18, left: w * 0.08 },
        });
        if (camera?.center && camera.zoom != null) {
          const center = mapbox.LngLat.convert(camera.center);
          overview = { center: [center.lng, center.lat], zoom: camera.zoom };
        }
      };

      const draw = () => {
        frame = null;
        if (!overview) return;
        lean.x += (lean.targetX - lean.x) * 0.08;
        lean.y += (lean.targetY - lean.y) * 0.08;
        const timeMs = progressRef.current * TOTAL;
        const timeline = evaluateTimeline(spec, timeMs);
        const pose = getCinematicCameraPose(ROUTE, timeline, overview, spec.aspectRatio);
        activeMap.jumpTo({
          ...pose,
          bearing: pose.bearing + lean.x * 4,
          pitch: Math.min(70, Math.max(0, pose.pitch + lean.y * 3)),
        });
        setRouteProgress(activeMap, ROUTE, timeline.routeProgress);

        const ctx = overlay.getContext("2d");
        if (ctx) {
          const width = overlay.clientWidth;
          const height = overlay.clientHeight;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          if (overlay.width !== Math.round(width * dpr) || overlay.height !== Math.round(height * dpr)) {
            overlay.width = Math.round(width * dpr);
            overlay.height = Math.round(height * dpr);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          drawFlightOverlay({
            ctx,
            project: (point) => activeMap.project(point),
            route: ROUTE,
            timeline,
            spec,
            unit: Math.min(width, height) / 1080,
            timeMs,
          });
        }
        // Keep easing until the pointer lean settles.
        if (Math.abs(lean.targetX - lean.x) > 0.002 || Math.abs(lean.targetY - lean.y) > 0.002) request();
      };
      const request = () => {
        if (frame == null && !disposed) frame = requestAnimationFrame(draw);
      };
      renderRef.current = request;

      activeMap.once("style.load", () => {
        if (disposed) return;
        installFlightScene(activeMap, spec, ROUTE);
        computeOverview();
        draw();
        activeMap.once("idle", () => {
          if (!disposed) setReady(true);
        });
      });

      resizeObserver = new ResizeObserver(() => {
        activeMap.resize();
        computeOverview();
        request();
      });
      resizeObserver.observe(container);

      if (window.matchMedia("(pointer: fine)").matches) {
        const onPointer = (event: PointerEvent) => {
          lean.targetX = (event.clientX / window.innerWidth - 0.5) * 2;
          lean.targetY = (event.clientY / window.innerHeight - 0.5) * 2;
          request();
        };
        window.addEventListener("pointermove", onPointer, { passive: true });
        removePointer = () => window.removeEventListener("pointermove", onPointer);
      }
    };

    void start();

    return () => {
      disposed = true;
      renderRef.current = null;
      if (frame != null) cancelAnimationFrame(frame);
      removePointer?.();
      resizeObserver?.disconnect();
      map?.remove();
    };
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const split = SplitText.create(".hero-title", { type: "lines,words", mask: "lines", wordsClass: "split-word" });
        gsap
          .timeline({ defaults: { ease: "expo.out" } })
          .from(".hero-eyebrow", { autoAlpha: 0, y: 14, duration: 0.8 })
          .from(split.words, { yPercent: 110, duration: 1.2, stagger: 0.045 }, "<0.1")
          .from(".hero-lede", { autoAlpha: 0, y: 18, duration: 1 }, "<0.45")
          .from(".hero .composer", { autoAlpha: 0, y: 22, duration: 1 }, "<0.1")
          .from(".hero-meta li", { autoAlpha: 0, y: 10, stagger: 0.06, duration: 0.7 }, "<0.2");
        return () => split.revert();
      });

      const scrubTimeline = (pinLength: string) => {
        rootRef.current?.classList.add("is-scrubbing");
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: rootRef.current,
            start: "top top",
            end: `+=${pinLength}`,
            pin: stageRef.current,
            scrub: 0.6,
            anticipatePin: 1,
            onLeave: () => document.documentElement.classList.remove("is-flying"),
            onLeaveBack: () => document.documentElement.classList.remove("is-flying"),
            onUpdate: (self) => {
              const p = self.progress;
              // Cinematic mode: once the flight is under way the page chrome
              // steps aside and the scene owns the whole screen.
              document.documentElement.classList.toggle("is-flying", self.isActive && p > 0.03 && p < 0.995);
              progressRef.current = p;
              renderRef.current?.();
              if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
              if (timecodeRef.current) timecodeRef.current.textContent = formatTimecode(p);
              const { routeProgress } = evaluateTimeline({ ...HERO_SPEC, aspectRatio: "16:9" }, p * TOTAL);
              if (distanceRef.current) {
                distanceRef.current.textContent = Math.round(routeProgress * HERO_SPEC.route.distanceKm).toLocaleString("en-US");
              }
              if (altitudeRef.current) {
                const feet = Math.round((flightAltitude(routeProgress) * CRUISE_FT) / 100) * 100;
                altitudeRef.current.textContent = feet === 0 ? "Ground" : `${feet.toLocaleString("en-US")} ft`;
              }
            },
          },
        });
        triggerRef.current = tl.scrollTrigger ?? null;

        // Intro copy clears out quickly, before the camera really moves, and
        // the flight instruments (HUD + scene bar) take its place.
        tl.to(".hero-copy", { autoAlpha: 0, y: -50, duration: 0.035 }, 0.01)
          .to(".hero-shade", { opacity: 0.35, duration: 0.06 }, 0.01)
          .fromTo(".hero-hud, .hero-scrubber", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.04 }, 0.045);

        // Scene captions cross-fade in step with the flight.
        const caption = (selector: string, start: number, end: number) => {
          tl.fromTo(selector, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.04 }, start)
            .to(selector, { autoAlpha: 0, y: -26, duration: 0.04 }, end - 0.04);
        };
        caption(".caption-departure", T.originStart, T.flightStart + 0.05);
        caption(".caption-cruise", T.flightStart + 0.1, T.flightEnd - 0.06);
        caption(".caption-arrival", T.flightEnd - 0.03, T.outroStart + 0.02);

        // Finale: the full route is on screen, invite them to make their own.
        tl.fromTo(".hero-finale", { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.06 }, T.outroStart + 0.04)
          .to(".hero-shade", { opacity: 0.8, duration: 0.08 }, T.outroStart + 0.02)
          .to(".hero-hud, .hero-scrubber", { autoAlpha: 0, duration: 0.04 }, T.outroStart + 0.04)
          .set({}, {}, 1);

        return () => {
          document.documentElement.classList.remove("is-flying");
          rootRef.current?.classList.remove("is-scrubbing");
          triggerRef.current = null;
        };
      };

      mm.add(MOTION_QUERIES.desktop, () => scrubTimeline("320%"));
      mm.add(MOTION_QUERIES.mobile, () => scrubTimeline("240%"));

      return () => mm.revert();
    },
    { scope: rootRef }
  );

  // Clicking a scene on the scrubber scrolls the page to that point in the flight.
  function jumpTo(progress: number) {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const top = trigger.start + (trigger.end - trigger.start) * (progress + 0.004);
    window.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <section ref={rootRef} className="hero" aria-labelledby="hero-title">
      <div ref={stageRef} className={`hero-stage ${ready ? "is-ready" : ""}`}>
        <picture className="hero-poster">
          <source media="(max-width: 899px) and (orientation: portrait)" srcSet="/hero/poster-tall-start.jpg" />
          <img src="/hero/poster-wide-start.jpg" alt="" />
        </picture>
        <picture className="hero-poster hero-poster-end">
          <source media="(max-width: 899px) and (orientation: portrait)" srcSet="/hero/poster-tall-end.jpg" />
          <img src="/hero/poster-wide-end.jpg" alt="" />
        </picture>
        <div
          ref={mapRef}
          className="hero-map"
          role="img"
          aria-label="A live MapMyFlight scene: a plane flies the great-circle route from Delhi to Tokyo as you scroll"
        />
        <canvas ref={overlayRef} className="hero-overlay" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />

        <div className="container hero-copy">
          <p className="eyebrow hero-eyebrow"><span className="eyebrow-line" /> Cinematic travel films</p>
          <h1 id="hero-title" className="hero-title">
            Every journey deserves an <em>opening&nbsp;scene.</em>
          </h1>
          <p className="hero-lede">
            Type two places. MapMyFlight flies the route for you, with a real
            great-circle path, a chase camera over 3D terrain and a clean finish.
            You get a 1080p film, rendered right in your browser.
          </p>
          <RouteComposer id="hero" />
          <ul className="hero-meta">
            <li><Icon name="check" size={14} /> No sign-up</li>
            <li><Icon name="check" size={14} /> Rendered on your device</li>
            <li><Icon name="check" size={14} /> 16:9 &amp; 9:16</li>
          </ul>
        </div>

        <div className="hero-captions" aria-hidden="true">
          <div className="hero-caption caption-departure">
            <span className="caption-kicker">Scene 01 · Departure</span>
            <strong>Delhi</strong>
            <span className="caption-meta">28.61° N · 77.21° E</span>
          </div>
          <div className="hero-caption caption-cruise">
            <span className="caption-kicker">Scene 02 · Cruise</span>
            <strong>5,837 km on the great circle</strong>
            <span className="caption-meta">The camera chases, cranes up, swings around</span>
          </div>
          <div className="hero-caption caption-arrival">
            <span className="caption-kicker">Scene 03 · Arrival</span>
            <strong>Tokyo</strong>
            <span className="caption-meta">35.69° N · 139.69° E</span>
          </div>
        </div>

        <div className="hero-finale">
          <p className="eyebrow"><span className="eyebrow-line" /> Made with MapMyFlight</p>
          <h2>Your journey, <em>in motion.</em></h2>
          <p>That whole scene came from two place names and one click.</p>
          <div className="hero-finale-actions">
            <Link href="/studio" className="btn btn-gold">Make yours <Icon name="arrow" size={16} /></Link>
            <a href="#how" className="btn btn-ghost">See how it works</a>
          </div>
        </div>

        <div className="hero-hud" aria-hidden="true">
          <div><span>TC</span><span ref={timecodeRef}>00:00:00:00</span></div>
          <div><span>Dist</span><span><span ref={distanceRef}>0</span> km</span></div>
          <div><span>Alt</span><span ref={altitudeRef}>Ground</span></div>
        </div>

        <div className="hero-scrubber">
          <div className="hero-scrubber-track">
            {SCENES.map((scene) => (
              <button
                key={scene.label}
                type="button"
                className="hero-scrubber-scene"
                style={{ flexGrow: scene.end - scene.start }}
                onClick={() => jumpTo(scene.start)}
                aria-label={`Jump to ${scene.label}`}
              >
                <span>{scene.label}</span>
              </button>
            ))}
            <span ref={fillRef} className="hero-scrubber-fill" aria-hidden="true" />
          </div>
          <p className="hero-scrubber-hint"><span aria-hidden="true" className="scroll-dot" /> Scroll to fly</p>
        </div>
      </div>
    </section>
  );
}
