/** Canonical site facts, shared by metadata, the sitemap and structured data. */
export const SITE = {
  name: "MapMyFlight",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mapmyflight.anshbhatt.space").replace(/\/$/, ""),
  title: "MapMyFlight — Cinematic flight-route videos, made in your browser",
  description:
    "Type two places and get a cinematic flight-route video: a true great-circle path, a 3D chase camera and a clean finish. Free, no sign-up, rendered in 1080p on your own device as MP4 or WebM, in 16:9 or 9:16.",
  author: { name: "Ansh Bhatt", url: "https://github.com/ansh-logics" },
  repository: "https://github.com/ansh-logics/MapMyFlight",
  keywords: [
    "flight route video",
    "travel video maker",
    "flight path animation",
    "travel map animation",
    "great circle route",
    "animated travel map",
    "route animation",
    "Instagram Reels travel video",
    "YouTube travel intro",
    "map video generator",
    "MapMyFlight",
  ],
} as const;
