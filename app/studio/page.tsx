import { Suspense } from "react";
import type { Metadata } from "next";
import StudioApp from "@/components/studio/StudioApp";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "Type an origin and a destination, choose a map style and export a cinematic 1080p flight-route film in 16:9 or 9:16. Free, no sign-up, rendered on your device.",
  alternates: { canonical: "/studio" },
  openGraph: { url: "/studio", title: "MapMyFlight Studio — make a flight-route film" },
};

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="studio" />}>
      <StudioApp />
    </Suspense>
  );
}
