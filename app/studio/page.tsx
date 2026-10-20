import { Suspense } from "react";
import type { Metadata } from "next";
import StudioApp from "@/components/studio/StudioApp";

export const metadata: Metadata = {
  title: "Studio — MapMyFlight",
  description: "Direct and export a cinematic flight-route film in 1080p, right in your browser.",
};

export default function StudioPage() {
  return (
    <Suspense fallback={<main className="studio-app" />}>
      <StudioApp />
    </Suspense>
  );
}
