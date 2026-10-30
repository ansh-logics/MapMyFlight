import Link from "next/link";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeOpacity=".25" />
      <path d="M6.5 21.5C10 11 20 8 25.5 10.5" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.5 3.2" />
      <circle cx="6.5" cy="21.5" r="2" fill="var(--gold)" />
      <path d="m23.4 7.6 3.9 2.6-3.3 3.1" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Logo() {
  return (
    <Link href="/" className="logo" aria-label="MapMyFlight home">
      <LogoMark />
      <span>
        MapMy<em>Flight</em>
      </span>
    </Link>
  );
}
