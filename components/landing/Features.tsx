"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";
import Icon, { type IconName } from "@/components/ui/Icon";
import { MAP_THEMES } from "@/lib/render-spec";

const FEATURES: { icon: IconName; title: string; body: string; wide?: boolean }[] = [
  {
    icon: "film",
    title: "True 1080p, frame by frame",
    body: "The export never records your screen. Each frame is drawn at full resolution and encoded with WebCodecs, so routes, type and terrain stay sharp.",
    wide: true,
  },
  { icon: "lock", title: "Private by design", body: "Rendering happens on your machine. No uploads, no render queue, no account." },
  { icon: "globe", title: "Real flight paths", body: "Great-circle arcs over 3D terrain, with an aircraft that banks into the curve." },
  { icon: "spark", title: "A camera with intent", body: "Push-ins, a chase, a crane at cruise and a final reveal, in one continuous move." },
  { icon: "palette", title: "Two cartographic worlds", body: "Midnight Atlas or Ivory Journal, then your own route, aircraft and accent colours." },
];

export default function Features() {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".features .section-head > *", {
          autoAlpha: 0,
          y: 30,
          stagger: 0.1,
          scrollTrigger: { trigger: ".features .section-head", start: "top 80%" },
        });
        gsap.set(".feature-card", { autoAlpha: 0, y: 50 });
        const triggers = ScrollTrigger.batch(".feature-card", {
          start: "top 88%",
          onEnter: (batch) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, stagger: 0.1, duration: 1, ease: "expo.out", overwrite: true }),
        });
        return () => triggers.forEach((trigger) => trigger.kill());
      });
      return () => mm.revert();
    },
    { scope: rootRef }
  );

  // A soft spotlight follows the pointer across each card.
  function handlePointer(event: React.PointerEvent<HTMLElement>) {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    card.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  return (
    <section ref={rootRef} className="section features" aria-labelledby="features-title">
      <div className="container">
        <header className="section-head">
          <p className="eyebrow"><span className="eyebrow-line" /> Crafted details</p>
          <h2 id="features-title" className="section-title">Built like a film tool, <em>not a screen recorder.</em></h2>
        </header>
        <div className="bento">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className={`feature-card ${feature.wide ? "is-wide" : ""}`}
              onPointerMove={handlePointer}
            >
              <span className="feature-icon"><Icon name={feature.icon} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              {feature.title.startsWith("True 1080p") && (
                <div className="render-demo" aria-hidden="true">
                  <div className="render-demo-row"><span>Encoding frames</span><b>1080p · 30 fps</b></div>
                  <div className="render-demo-bar"><i /></div>
                </div>
              )}
              {feature.title === "Two cartographic worlds" && (
                <div className="theme-chips">
                  {Object.values(MAP_THEMES).map((theme) => (
                    <div key={theme.name} className="theme-chip">
                      <span className="theme-chip-swatch">
                        {theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}
                      </span>
                      <div>
                        <strong>{theme.name}</strong>
                        <small>{theme.description}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
