"use client";

import { useEffect, useId, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import type { RoutePoint } from "@/lib/render-spec";

const MAPBOX_GEOCODE = "https://api.mapbox.com/geocoding/v5/mapbox.places";

export type Place = {
  id: string;
  name: string;
  context: string;
  coordinates: RoutePoint;
};

type GeocodeFeature = {
  id: string;
  text: string;
  place_name: string;
  center: [number, number];
};

export async function searchPlaces(query: string, token: string, limit = 5, signal?: AbortSignal): Promise<Place[]> {
  const url = `${MAPBOX_GEOCODE}/${encodeURIComponent(query.trim())}.json?access_token=${token}&limit=${limit}&autocomplete=true&types=country,region,place,locality,poi`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const data = (await response.json()) as { features?: GeocodeFeature[] };
  return (data.features ?? []).map((feature) => ({
    id: feature.id,
    name: feature.text,
    context: feature.place_name.split(", ").slice(1).join(", "),
    coordinates: [feature.center[0], feature.center[1]],
  }));
}

/** A place input with Mapbox suggestions, full keyboard support and ARIA combobox semantics. */
export default function PlaceField({
  label,
  marker,
  value,
  placeholder,
  token,
  onChange,
  onSelect,
  onSubmit,
}: {
  label: string;
  marker: "origin" | "destination";
  value: string;
  placeholder: string;
  token?: string;
  onChange: (value: string) => void;
  onSelect: (place: Place) => void;
  onSubmit?: () => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const skipSearch = useRef(false);

  useEffect(() => {
    if (!token || !focused) return;
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const query = value.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (query.length < 2) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      try {
        const results = await searchPlaces(query, token, 5, controller.signal);
        setSuggestions(results);
        setHighlight(-1);
        setOpen(results.length > 0);
      } catch {
        // Aborted or offline: keep the last suggestions.
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value, token, focused]);

  function choose(place: Place) {
    skipSearch.current = true;
    onChange(place.name);
    onSelect(place);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && highlight >= 0) choose(suggestions[highlight]);
      else {
        setOpen(false);
        onSubmit?.();
      }
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={`place-field ${open ? "is-open" : ""}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="place-input">
        <span className={`place-marker place-marker-${marker}`} aria-hidden="true" />
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul id={listId} className="place-list" role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((place, index) => (
            <li
              key={place.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={index === highlight ? "is-highlighted" : ""}
              // mousedown, not click: it fires before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(place);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              <Icon name="pin" size={15} />
              <span>
                <strong>{place.name}</strong>
                {place.context && <small>{place.context}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
