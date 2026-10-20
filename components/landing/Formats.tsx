"use client";

import { useRef } from "react";
import Link from "next/link";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import Icon from "@/components/ui/Icon";

/**
 * One frame that reshapes from landscape to portrait as you scroll, showing
 * real frames from the two hero exports. Width and height are tweened in
 * pixels (not scale) so the image never distorts.
 */
export default function Formats() {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      const build = (pin: boolean, portraitWidth: number) => {
        const frame = rootRef.current?.querySelector<HTMLElement>(".format-frame");
        const stage = rootRef.current?.querySelector<HTMLElement>(".format-stage");
        if (!frame || !stage) return;
        const wide = () => Math.min(stage.clientWidth, (stage.clientHeight * 16) / 9);
        const tl = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: {
            trigger: pin ? ".formats-pin" : frame,
            start: pin ? "top top" : "top 70%",
            end: pin ? "+=160%" : "bottom 30%",
            pin: pin ? ".formats-pin" : false,
            scrub: 0.7,
            invalidateOnRefresh: true,
          },
        });
        tl.fromTo(
          frame,
          { width: () => wide(), height: () => (wide() * 9) / 16, borderRadius: 14 },
          {
            width: () => Math.min(portraitWidth, stage.clientWidth),
            height: () => (Math.min(portraitWidth, stage.clientWidth) * 16) / 9,
            borderRadius: 28,
            duration: 1,
          },
          0.15
        )
          .to(".format-img-wide", { autoAlpha: 0, duration: 0.35 }, 0.45)
          .fromTo(".format-img-tall", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, 0.45)
          .to(".format-tag-wide", { autoAlpha: 0, y: -10, duration: 0.2 }, 0.4)
          .fromTo(".format-tag-tall", { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.2 }, 0.7)
          .set({}, {}, 1.3);
      };
      mm.add(MOTION_QUERIES.desktop, () => build(true, 300));
      mm.add(MOTION_QUERIES.mobile, () => build(false, 220));
      return () => mm.revert();
    },
    { scope: rootRef }
  );

  return (
    <section ref={rootRef} id="formats" className="section formats" aria-labelledby="formats-title">
      <div className="formats-pin">
        <div className="container formats-grid">
          <div className="formats-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> Every screen</p>
            <h2 id="formats-title" className="section-title">One journey. <em>Framed for wherever it lands.</em></h2>
            <p className="section-lede">
              16:9 for YouTube, decks and the big screen. 9:16 for Reels, Shorts and
              TikTok. The vertical cut isn&apos;t a crop: the camera recomposes the whole
              flight for a tall frame.
            </p>
            <Link href="/studio" className="btn btn-ghost">
              Try both in the studio <Icon name="arrow" size={15} />
            </Link>
          </div>
          <div className="format-stage">
            <figure className="format-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="format-img format-img-wide" src="/hero/frame-wide-cruise.jpg" alt="A 16:9 frame from the Delhi to Tokyo film" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="format-img format-img-tall" src="/hero/frame-tall-cruise.jpg" alt="The same moment from the 9:16 vertical film" />
              <figcaption>
                <span className="format-tag format-tag-wide">16:9 · 1920 × 1080</span>
                <span className="format-tag format-tag-tall">9:16 · 1080 × 1920</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}
