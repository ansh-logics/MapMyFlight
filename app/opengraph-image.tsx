import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Rendered once at build time: a real frame from a MapMyFlight export
// (Delhi → Tokyo, the route drawn in gold) behind the brand type.
export const alt = "MapMyFlight: every journey deserves an opening scene. Cinematic flight-route films, made in your browser.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GOLD = "#e0b36a";
const INK = "#f3ede2";

export default async function OpengraphImage() {
  const root = process.cwd();
  const [serif, serifItalic, sans, backdrop] = await Promise.all([
    readFile(join(root, "assets/fonts/InstrumentSerif-Regular.ttf")),
    readFile(join(root, "assets/fonts/InstrumentSerif-Italic.ttf")),
    readFile(join(root, "assets/fonts/Geist-Medium.ttf")),
    readFile(join(root, "public/hero/poster-wide-end.jpg")),
  ]);
  const backdropSrc = `data:image/jpeg;base64,${backdrop.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: "#07080b" }}>
        <img src={backdropSrc} alt="" width={1120} height={630} style={{ position: "absolute", top: 0, left: 300, width: 1120, height: 630 }} />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            background: "linear-gradient(90deg, rgba(7,8,11,1) 0%, rgba(7,8,11,0.92) 40%, rgba(7,8,11,0.35) 70%, rgba(7,8,11,0.5) 100%)",
          }}
        />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", padding: "56px 72px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="44" height="44" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="15" fill="none" stroke={INK} strokeOpacity=".3" />
              <path d="M6.5 21.5C10 11 20 8 25.5 10.5" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.5 3.2" />
              <circle cx="6.5" cy="21.5" r="2" fill={GOLD} />
              <path d="m23.4 7.6 3.9 2.6-3.3 3.1" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ display: "flex", alignItems: "baseline", fontFamily: "Geist", fontSize: 28, color: INK, letterSpacing: -0.5 }}>
              MapMy
              <span style={{ fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 34, color: GOLD }}>Flight</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", flexDirection: "column", fontFamily: "Instrument Serif", fontSize: 92, lineHeight: 0.98, color: INK, letterSpacing: -2 }}>
              <span>Every journey deserves</span>
              <span style={{ display: "flex", gap: 22 }}>
                <span>an</span>
                <span style={{ fontStyle: "italic", color: GOLD }}>opening scene.</span>
              </span>
            </div>
            <div style={{ display: "flex", marginTop: 26, fontFamily: "Geist", fontSize: 28, color: "#c9c2b5", maxWidth: 640, lineHeight: 1.4 }}>
              Cinematic flight-route films, made in your browser. Two places in, a 1080p film out.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "Geist", fontSize: 20, color: "#8b8f99" }}>
            <div style={{ display: "flex", gap: 12 }}>
              {["Great-circle routes", "3D chase camera", "16:9 & 9:16"].map((label) => (
                <span
                  key={label}
                  style={{ display: "flex", padding: "8px 16px", border: "1px solid rgba(243,237,226,0.16)", borderRadius: 999, background: "rgba(7,8,11,0.55)", color: INK }}
                >
                  {label}
                </span>
              ))}
            </div>
            <span style={{ color: GOLD }}>mapmyflight.anshbhatt.space</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Instrument Serif", data: serif, style: "normal", weight: 400 },
        { name: "Instrument Serif", data: serifItalic, style: "italic", weight: 400 },
        { name: "Geist", data: sans, style: "normal", weight: 500 },
      ],
    }
  );
}
