"use client";

import { useRef } from "react";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import Icon, { type IconName } from "@/components/ui/Icon";
import { MAP_THEMES } from "@/lib/render-spec";

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "pin",
    title: "Set the route",
    body: "Type any two places on Earth. We find them and draw the true great-circle path between them, the way aircraft actually fly.",
  },
  {
    icon: "palette",
    title: "Direct the look",
    body: "Pick a cartographic world, tune the route and aircraft colours, and decide how long the flight scene should breathe.",
  },
  {
    icon: "film",
    title: "Export the film",
    body: "Every frame is rendered at full 1080p, encoded on your own device, and saved as an MP4 ready to post.",
  },
];

/** A stylised studio window whose three states follow the active step. */
function StudioMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <i /><i /><i />
        <span>MapMyFlight · Studio</span>
      </div>
      <div className="mock-body">
        <div className="mock-state mock-state-0">
          <span className="mock-label">Origin</span>
          <div className="mock-field"><span className="mock-dot" /><span className="mock-type">Delhi</span><i className="mock-caret" /></div>
          <span className="mock-label">Destination</span>
          <div className="mock-field"><span className="mock-dot is-solid" /><span className="mock-type">Tokyo</span><i className="mock-caret" /></div>
          <div className="mock-button">Create journey</div>
        </div>
        <div className="mock-state mock-state-1">
          <span className="mock-label">Cartographic world</span>
          <div className="mock-themes">
            {Object.values(MAP_THEMES).map((theme, index) => (
              <div key={theme.name} className={`mock-theme ${index === 0 ? "is-active" : ""}`}>
                <span>{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>
                <small>{theme.name}</small>
              </div>
            ))}
          </div>
          <span className="mock-label">Flight scene</span>
          <div className="mock-slider"><i className="mock-slider-fill" /></div>
        </div>
        <div className="mock-state mock-state-2">
          <span className="mock-label">Export</span>
          <div className="mock-export">
            <div><strong>delhi-to-tokyo.mp4</strong><small>1920 × 1080 · 30 fps</small></div>
            <b className="mock-percent">0%</b>
          </div>
          <div className="mock-progress"><i className="mock-progress-fill" /></div>
          <div className="mock-button is-done"><Icon name="check" size={14} /> Video ready</div>
        </div>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(MOTION_QUERIES.desktop, () => {
        rootRef.current?.classList.add("is-animated");
        const steps = gsap.utils.toArray<HTMLElement>(".how-step");
        const states = gsap.utils.toArray<HTMLElement>(".mock-state");
        gsap.set(states.slice(1), { autoAlpha: 0, y: 20 });
        gsap.set(steps.slice(1), { opacity: 0.35 });

        const percentEl = rootRef.current?.querySelector<HTMLElement>(".mock-percent");
        const percent = { value: 0 };
        const tl = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: {
            trigger: ".how-pin",
            start: "top top",
            end: "+=220%",
            pin: true,
            scrub: 0.8,
          },
        });

        // Step 1 plays as the section arrives, so the fields are filled in
        // by the time it pins: the place names type themselves, caret and all.
        const fields = gsap.utils.toArray<HTMLElement>(".mock-state-0 .mock-field");
        const typing = gsap.timeline({
          scrollTrigger: { trigger: ".how-pin", start: "top 75%", toggleActions: "play none none none" },
        });
        fields.forEach((field) => {
          const text = field.querySelector<HTMLElement>(".mock-type");
          if (!text) return;
          const value = text.textContent ?? "";
          gsap.set(text, { text: "" });
          typing
            .call(() => field.classList.add("is-typing"))
            .to(text, { text: value, duration: value.length * 0.09, ease: "none" })
            .call(() => field.classList.remove("is-typing"), [], "+=0.25");
        });
        typing.from(".mock-state-0 .mock-button", { scale: 0.94, opacity: 0.5, duration: 0.4, ease: "back.out(2)" }, "-=0.1");

        tl.to(".how-progress-fill", { scaleY: 1, ease: "none", duration: 3 }, 0)
          // Step 2
          .to(states[0], { autoAlpha: 0, y: -20, duration: 0.3 }, 1)
          .to(states[1], { autoAlpha: 1, y: 0, duration: 0.3 }, 1.1)
          .to(steps[0], { opacity: 0.35, duration: 0.2 }, 1)
          .to(steps[1], { opacity: 1, duration: 0.2 }, 1)
          .fromTo(".mock-slider-fill", { scaleX: 0.25 }, { scaleX: 0.62, duration: 0.6 }, 1.3)
          // Step 3: the render bar fills and the counter runs.
          .to(states[1], { autoAlpha: 0, y: -20, duration: 0.3 }, 2)
          .to(states[2], { autoAlpha: 1, y: 0, duration: 0.3 }, 2.1)
          .to(steps[1], { opacity: 0.35, duration: 0.2 }, 2)
          .to(steps[2], { opacity: 1, duration: 0.2 }, 2)
          .fromTo(".mock-progress-fill", { scaleX: 0 }, { scaleX: 1, ease: "none", duration: 0.7 }, 2.2)
          .fromTo(
            percent,
            { value: 0 },
            {
              value: 100,
              ease: "none",
              duration: 0.7,
              // Whole numbers only: the counter reads like a real render.
              onUpdate: () => {
                if (percentEl) percentEl.textContent = `${Math.round(percent.value)}%`;
              },
            },
            2.2
          )
          .from(".mock-state-2 .mock-button", { autoAlpha: 0, y: 8, duration: 0.2 }, 2.9);

        return () => rootRef.current?.classList.remove("is-animated");
      });

      mm.add(MOTION_QUERIES.mobile, () => {
        gsap.utils.toArray<HTMLElement>(".how-step").forEach((step) => {
          gsap.from(step, {
            autoAlpha: 0,
            y: 40,
            duration: 1,
            scrollTrigger: { trigger: step, start: "top 85%" },
          });
        });
      });

      return () => mm.revert();
    },
    { scope: rootRef }
  );

  return (
    <section ref={rootRef} id="how" className="section how" aria-labelledby="how-title">
      <div className="how-pin">
        <div className="container how-inner">
          <header className="how-head">
            <p className="eyebrow"><span className="eyebrow-line" /> How it works</p>
            <h2 id="how-title" className="section-title">
              Two place names. <em>One finished film.</em>
            </h2>
          </header>
          <div className="how-grid">
            <div className="how-steps-wrap">
            <span className="how-progress" aria-hidden="true"><i className="how-progress-fill" /></span>
            <ol className="how-steps">
              {STEPS.map((step, index) => (
                <li key={step.title} className="how-step">
                  <span className="how-step-icon"><Icon name={step.icon} size={18} /></span>
                  <div>
                    <span className="how-step-number">Step {String(index + 1).padStart(2, "0")}</span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            </div>
            <StudioMock />
          </div>
        </div>
      </div>
    </section>
  );
}
