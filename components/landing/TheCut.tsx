"use client";

import { useRef } from "react";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { DEFAULT_TIMINGS, getTotalDuration } from "@/lib/render-spec";

const TOTAL_MS = getTotalDuration(DEFAULT_TIMINGS);
const SCENES = [
  { label: "Intro", ms: DEFAULT_TIMINGS.introMs, note: "A wide establishing shot that slowly pushes toward the route." },
  { label: "Departure", ms: DEFAULT_TIMINGS.originHoldMs, note: "The camera descends onto the origin as the runway lights pulse." },
  { label: "Flight", ms: DEFAULT_TIMINGS.flightMs, note: "A chase over 3D terrain that cranes up at cruise and swings around the aircraft." },
  { label: "Arrival", ms: DEFAULT_TIMINGS.destinationHoldMs, note: "It pushes in for touchdown at the destination." },
  { label: "Outro", ms: DEFAULT_TIMINGS.outroMs, note: "Pull back to reveal the whole journey, drawn in gold." },
];

export default function TheCut() {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".cut-head > *", {
          autoAlpha: 0,
          y: 30,
          stagger: 0.1,
          scrollTrigger: { trigger: ".cut-head", start: "top 80%" },
        });

        // The playhead is tied to scroll; each scene lights up as it passes.
        const notes = gsap.utils.toArray<HTMLElement>(".cut-note");
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ".cut-board",
            start: "top 75%",
            end: "bottom 35%",
            scrub: 0.5,
          },
        });
        tl.fromTo(".cut-playhead", { left: "0%" }, { left: "100%", ease: "none", duration: TOTAL_MS }, 0);
        let offset = 0;
        SCENES.forEach((scene, index) => {
          tl.to(`.cut-scene:nth-child(${index + 1})`, { "--lit": 1, duration: scene.ms * 0.25 }, offset);
          tl.fromTo(notes[index], { opacity: 0.3 }, { opacity: 1, duration: scene.ms * 0.3 }, offset);
          offset += scene.ms;
        });
      });
      mm.add(MOTION_QUERIES.reduced, () => {
        gsap.set(".cut-scene", { "--lit": 1 });
      });
      return () => mm.revert();
    },
    { scope: rootRef }
  );

  return (
    <section ref={rootRef} id="cut" className="section cut" aria-labelledby="cut-title">
      <div className="container">
        <header className="section-head section-head-split cut-head">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> The cut</p>
            <h2 id="cut-title" className="section-title">Five scenes, <em>one continuous take.</em></h2>
          </div>
          <p className="section-lede">
            Every film follows the same carefully paced edit. The camera never cuts.
            It eases from one beat to the next, so a {(TOTAL_MS / 1000).toFixed(1)}-second
            clip plays like a title sequence.
          </p>
        </header>

        <div className="cut-board">
          <div className="cut-track">
            {SCENES.map((scene) => (
              <div key={scene.label} className="cut-scene" style={{ flexGrow: scene.ms }}>
                <span className="cut-scene-label">{scene.label}</span>
                <span className="cut-scene-time">{(scene.ms / 1000).toFixed(1)}s</span>
              </div>
            ))}
            <span className="cut-playhead" aria-hidden="true" />
          </div>
          <ol className="cut-notes">
            {SCENES.map((scene, index) => (
              <li key={scene.label} className="cut-note">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{scene.label}</strong>
                  <p>{scene.note}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
