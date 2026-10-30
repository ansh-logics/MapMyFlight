import "./landing.css";
import SiteNav from "@/components/landing/SiteNav";
import HeroFlight from "@/components/landing/HeroFlight";
import HowItWorks from "@/components/landing/HowItWorks";
import TheCut from "@/components/landing/TheCut";
import Formats from "@/components/landing/Formats";
import Features from "@/components/landing/Features";
import SiteFooter from "@/components/landing/SiteFooter";
import Icon from "@/components/ui/Icon";
import { DEFAULT_TIMINGS, getTotalDuration } from "@/lib/render-spec";
import { SITE } from "@/lib/site";

const ROUTES = [
  ["Delhi", "Tokyo", "5,837 km"],
  ["New York", "London", "5,570 km"],
  ["Paris", "Tokyo", "9,710 km"],
  ["Sydney", "Singapore", "6,300 km"],
  ["Mumbai", "Dubai", "1,930 km"],
  ["Los Angeles", "Honolulu", "4,110 km"],
  ["Cape Town", "Lisbon", "8,520 km"],
  ["Reykjavík", "Paris", "2,240 km"],
];

const TOTAL_SECONDS = Math.round(getTotalDuration(DEFAULT_TIMINGS) / 1000);

const FAQS = [
  {
    q: "Do I need an account?",
    a: "No. Open the studio, type two places and start directing. There is nothing to sign up for.",
  },
  {
    q: "Is anything uploaded?",
    a: "Only the place names you type are sent to Mapbox so we can find their coordinates. The film itself is rendered and encoded in your browser and never leaves your device.",
  },
  {
    q: "Which formats can I export?",
    a: "MP4 (H.264) in browsers with WebCodecs support, such as recent Chrome and Edge. Elsewhere the studio switches to WebM automatically.",
  },
  {
    q: "How long is each film?",
    a: `About ${TOTAL_SECONDS} seconds by default. You can stretch or tighten the flight scene between 3.5 and 9 seconds.`,
  },
  {
    q: "Can I make vertical videos for Reels and Shorts?",
    a: "Yes. Switch to 9:16 and the camera recomposes the whole flight for a portrait frame.",
  },
  {
    q: "Why is there a Mapbox credit in the corner?",
    a: "Map data comes from Mapbox and OpenStreetMap, whose terms require visible attribution. We keep it small.",
  },
];

// Structured data: the product itself, plus the FAQ for rich results.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Any (modern web browser)",
      browserRequirements: "Requires WebGL. MP4 export uses WebCodecs (recent Chrome or Edge); other browsers export WebM.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Great-circle flight routes between any two places",
        "Cinematic 3D chase camera over terrain",
        "1080p export in 16:9 and 9:16",
        "Rendered locally in the browser, no uploads",
      ],
      image: `${SITE.url}/opengraph-image`,
      author: { "@type": "Person", name: SITE.author.name, url: SITE.author.url },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
};

export default function Home() {
  return (
    <div className="site">
      <script
        type="application/ld+json"
        // JSON.stringify escapes the content; "<" is escaped too so the tag can't be closed early.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }}
      />
      <a href="#main" className="skip-link">Skip to content</a>
      <SiteNav />
      <main id="main">
        <HeroFlight />

        <div className="marquee" aria-label="Example routes">
          <div className="marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1}>
                {ROUTES.map(([from, to, km]) => (
                  <li key={`${copy}-${from}-${to}`}>
                    <span>{from}</span>
                    <Icon name="plane" size={14} className="marquee-plane" />
                    <span>{to}</span>
                    <small>{km}</small>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <HowItWorks />
        <TheCut />
        <Formats />
        <Features />

        <section id="faq" className="section faq-section" aria-labelledby="faq-title">
          <div className="container faq-layout">
            <header className="section-head">
              <p className="eyebrow"><span className="eyebrow-line" /> Questions</p>
              <h2 id="faq-title" className="section-title">Before <em>take-off.</em></h2>
            </header>
            <div className="faq">
              {FAQS.map((item) => (
                <details key={item.q} className="faq-item">
                  <summary>
                    {item.q}
                    <span className="faq-toggle" aria-hidden="true" />
                  </summary>
                  <div className="faq-answer"><p>{item.a}</p></div>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
