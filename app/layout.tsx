import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "MapMyFlight — Cinematic Travel Video Studio",
  description: "Create stunning 3D cinematic travel videos and flight animations for your journeys. Premium map animations, easy export in 1080p, and beautifully rendered routes.",
  keywords: ["travel video", "flight animation", "map animation", "MapMyFlight", "3D route", "travel map", "route animation", "cinematic map"],
  openGraph: {
    title: "MapMyFlight — Cinematic Travel Video Studio",
    description: "Create stunning 3D cinematic travel videos and flight animations for your journeys.",
    type: "website",
    siteName: "MapMyFlight",
  },
  twitter: {
    card: "summary_large_image",
    title: "MapMyFlight — Cinematic Travel Video Studio",
    description: "Create stunning 3D cinematic travel videos and flight animations for your journeys.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Font variables live on <html> so :root-level tokens can resolve them.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
