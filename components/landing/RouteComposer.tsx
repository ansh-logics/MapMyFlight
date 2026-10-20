"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";

/** The primary conversion: two places in, straight into the studio. */
export default function RouteComposer({
  id,
  defaultFrom = "Delhi",
  defaultTo = "Tokyo",
  className = "",
}: {
  id: string;
  defaultFrom?: string;
  defaultTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (from.trim()) params.set("from", from.trim());
    if (to.trim()) params.set("to", to.trim());
    router.push(`/studio?${params.toString()}`);
  }

  return (
    <form className={`composer ${className}`} onSubmit={handleSubmit} aria-label="Start a journey">
      <label className="composer-field" htmlFor={`${id}-from`}>
        <span>From</span>
        <input
          id={`${id}-from`}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder="Departure city"
          autoComplete="off"
          required
        />
      </label>
      <span className="composer-divider" aria-hidden="true">
        <Icon name="plane" size={15} />
      </span>
      <label className="composer-field" htmlFor={`${id}-to`}>
        <span>To</span>
        <input
          id={`${id}-to`}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="Destination"
          autoComplete="off"
          required
        />
      </label>
      <button type="submit" className="btn btn-gold composer-submit">
        Create film <Icon name="arrow" size={16} />
      </button>
    </form>
  );
}
