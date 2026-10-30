"use client";

import { useRef } from "react";
import Link from "next/link";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import RouteComposer from "@/components/landing/RouteComposer";
import Logo from "@/components/ui/Logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/studio", label: "Open the studio", internal: true },
      { href: "#how", label: "How it works" },
      { href: "#formats", label: "Formats" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "#cut", label: "The cut" },
      { href: "#faq", label: "FAQ" },
    ],
  },
];

/** The closing call to action and the site footer, as one piece. */
export default function SiteFooter() {
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const split = SplitText.create(".footer-cta-title", { type: "words", mask: "words", wordsClass: "split-word" });
        const tl = gsap.timeline({
          scrollTrigger: { trigger: ".footer-cta", start: "top 75%", end: "center 55%", scrub: 0.8 },
        });
        tl.from(".footer-arc-path", { drawSVG: "0%", ease: "none", duration: 1 }, 0)
          .from(".footer-arc-city", { scale: 0, transformOrigin: "50% 50%", stagger: 0.8, duration: 0.2 }, 0)
          .from(split.words, { yPercent: 100, stagger: 0.06, duration: 0.5, ease: "power3.out" }, 0.2)
          .from(".footer-cta .composer", { autoAlpha: 0, y: 30, duration: 0.4 }, 0.6);
        return () => split.revert();
      });
      return () => mm.revert();
    },
    { scope: rootRef }
  );

  return (
    <footer ref={rootRef} className="site-footer" aria-labelledby="footer-cta-title">
      <div className="footer-cta">
        <svg className="footer-arc" viewBox="0 0 1200 420" aria-hidden="true">
          <defs>
            <linearGradient id="footer-arc-gold" x1="0" x2="1">
              <stop offset="0" stopColor="#b98a45" stopOpacity=".25" />
              <stop offset=".5" stopColor="#f2cf92" />
              <stop offset="1" stopColor="#e0b36a" />
            </linearGradient>
          </defs>
          <path className="footer-arc-path" d="M60 400 C 110 -190, 1090 -190, 1140 400" fill="none" stroke="url(#footer-arc-gold)" strokeWidth="1.6" strokeLinecap="round" />
          <circle className="footer-arc-city" cx="60" cy="400" r="5" />
          <circle className="footer-arc-city" cx="1140" cy="400" r="5" />
        </svg>
        <div className="container footer-cta-inner">
          <p className="eyebrow"><span className="eyebrow-line" /> Your next scene</p>
          <h2 id="footer-cta-title" className="footer-cta-title">Where are you <em>flying next?</em></h2>
          <RouteComposer id="cta" defaultFrom="London" defaultTo="New York" />
        </div>
      </div>

      <div className="container footer-main">
        <div className="footer-brand">
          <Logo />
          <p>Cinematic flight-route films, made in your browser. Type two places, direct the look, export in 1080p.</p>
        </div>
        <nav className="footer-columns" aria-label="Footer">
          {COLUMNS.map((column) => (
            <div key={column.title} className="footer-column">
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"internal" in link ? <Link href={link.href}>{link.label}</Link> : <a href={link.href}>{link.label}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="container footer-base">
        <span>© {new Date().getFullYear()} MapMyFlight · Made with care by Ansh</span>
        <span>Map data © Mapbox © OpenStreetMap</span>
      </div>
    </footer>
  );
}
