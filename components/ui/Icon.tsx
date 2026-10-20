export type IconName =
  | "arrow"
  | "plane"
  | "pin"
  | "palette"
  | "film"
  | "lock"
  | "phone"
  | "globe"
  | "check"
  | "menu"
  | "close"
  | "spark";

const paths: Record<IconName, React.ReactNode> = {
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  plane: <path d="M21 15.5v-1.8l-7.5-4.6V4.3a1.5 1.5 0 0 0-3 0v4.8L3 13.7v1.8l7.5-2.3v4.6L8.4 19.4V21l3.6-1 3.6 1v-1.6l-2.1-1.6v-4.6l7.5 2.3Z" />,
  pin: <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4Z" /><circle cx="7.5" cy="11.5" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15.5" cy="8.5" r="1" /></>,
  film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  menu: <><path d="M4 8h16" /><path d="M4 16h16" /></>,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  spark: <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />,
};

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
