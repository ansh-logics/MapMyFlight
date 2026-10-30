/**
 * The MapMyFlight mark as a self-contained element for next/og image routes
 * (favicon, Apple touch icon). Satori needs explicit sizes and flex layout.
 */
export function BrandMarkIcon({ size }: { size: number }) {
  const radius = Math.round(size * 0.22);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius,
        background: "linear-gradient(160deg, #161a23 0%, #07080b 100%)",
      }}
    >
      <svg width={size * 0.78} height={size * 0.78} viewBox="0 0 32 32">
        <path d="M6.5 21.5C10 11 20 8 25.5 10.5" fill="none" stroke="#e0b36a" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0.6 3.6" />
        <circle cx="6.5" cy="21.5" r="2.6" fill="#e0b36a" />
        <path d="m22.8 7 4.5 3.1-3.8 3.6" fill="none" stroke="#f2cf92" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
