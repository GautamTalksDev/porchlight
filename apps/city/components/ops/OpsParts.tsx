"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { JourneyHop } from "@/lib/journey";
import type { SignTimestamps } from "@/lib/power";
import { IconBulb, IconEye, IconMenu, IconMove } from "@/components/ui/Icons";

/* Command menu */

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  tone?: "signal" | "porch" | "moon";
  shortcut?: string;
  href?: string;
  external?: boolean;
  onSelect?: () => void;
}

export interface MenuGroup {
  id: string;
  heading: string;
  items: MenuItem[];
}

/** One quiet button that opens every room control, grouped by what it affects. */
export function CommandMenu({
  open,
  onOpenChange,
  groups,
  who,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: MenuGroup[];
  who: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    // Move focus into the menu for keyboard users.
    const first = wrapRef.current?.querySelector<HTMLElement>(".menu-item");
    first?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>(".menu-item") ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  };

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-quiet btn-small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <IconMenu />
        Menu
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="menu lantern"
            role="menu"
            aria-label="Room controls"
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 36 }}
          >
            {groups.map((g) => (
              <div className="menu-group" key={g.id} role="group" aria-label={g.heading}>
                <p className="menu-heading" aria-hidden="true">{g.heading}</p>
                {g.items.map((it) => {
                  const body = (
                    <>
                      {it.icon}
                      <span className="menu-item-text">
                        <span>{it.label}</span>
                        {it.hint ? <small>{it.hint}</small> : null}
                      </span>
                      {it.shortcut ? <kbd>{it.shortcut}</kbd> : <span />}
                    </>
                  );
                  return it.href ? (
                    <a
                      key={it.id}
                      className="menu-item"
                      role="menuitem"
                      data-tone={it.tone}
                      href={it.href}
                      target={it.external ? "_blank" : undefined}
                      rel={it.external ? "noopener noreferrer" : undefined}
                      onClick={() => onOpenChange(false)}
                    >
                      {body}
                    </a>
                  ) : (
                    <button
                      key={it.id}
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      data-tone={it.tone}
                      onClick={() => {
                        onOpenChange(false);
                        it.onSelect?.();
                      }}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            ))}
            <p className="menu-who">Signed in as {who}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* Signs of life */

function agoShort(at: number | undefined, now: number): string {
  if (at == null) return "Nothing yet";
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}

/** Three instruments from the beacon: it was moved, someone moved in view, and whether the lights are on. */
export function Vitals({ signs, powerOut, now }: { signs: SignTimestamps | null | undefined; powerOut: boolean; now: number }) {
  const s = signs ?? {};
  const hasLight = s.lights_on != null || s.lights_off != null;
  const lightsOn = hasLight && (s.lights_off == null || (s.lights_on != null && s.lights_on >= s.lights_off));
  return (
    <div className="vitals" role="group" aria-label="Signs of life from the beacon">
      <div className="vital" data-on={String(s.motion != null)}>
        <IconMove />
        <span className="vital-label">Moved</span>
        <span className="vital-value">{agoShort(s.motion, now)}</span>
      </div>
      <div className="vital" data-on={String(s.presence != null)}>
        <IconEye />
        <span className="vital-label">Someone seen</span>
        <span className="vital-value">{agoShort(s.presence, now)}</span>
      </div>
      <div className="vital" data-on={String(lightsOn)} data-alarm={String(powerOut || (hasLight && !lightsOn))}>
        <IconBulb />
        <span className="vital-label">Lights</span>
        <span className="vital-value">{!hasLight ? "Unknown" : lightsOn ? "On" : powerOut ? "Out, needs power" : "Out"}</span>
      </div>
    </div>
  );
}

/* The call's journey */

const HOW: Record<string, string> = {
  Bluetooth: "Bluetooth",
  "Neighbour to neighbour": "Neighbour to neighbour",
  "To City Hall": "Uplink",
};

/** The hops drawn as a chain of lights: red where it began, amber on the street, moonlight at City Hall. */
export function JourneyChain({ hops }: { hops: JourneyHop[] }) {
  if (!hops.length) return null;
  const stops: { label: string; role: "origin" | "relay" | "city" }[] = [{ label: hops[0]!.fromLabel, role: "origin" }];
  for (const hop of hops) stops.push({ label: hop.kind === "To City Hall" ? "City Hall" : hop.toLabel, role: hop.kind === "To City Hall" ? "city" : "relay" });
  return (
    <ol className="chain" aria-label="Route this call took">
      {stops.map((stop, i) => {
        const hop = i > 0 ? hops[i - 1] : null;
        const heldSecs = hop?.heldMs != null && hop.heldMs >= 3000 ? Math.max(1, Math.round(hop.heldMs / 1000)) : null;
        return (
          <li key={`${stop.label}-${i}`} style={{ display: "contents" }}>
            {hop ? (
              <span className="chain-link" data-kind={hop.kind} aria-hidden="true">
                <span className="chain-line" />
                <span className="chain-how">
                  {HOW[hop.kind] ?? hop.kind}
                  {heldSecs ? <span className="chain-held">, held {heldSecs} s</span> : null}
                </span>
              </span>
            ) : null}
            <span className="chain-stop" data-role={stop.role}>
              <span className="chain-dot" aria-hidden="true" />
              <span className="chain-name">
                {stop.label}
                {hop ? <span className="visually-hidden">, by {HOW[hop.kind] ?? hop.kind}{heldSecs ? `, held ${heldSecs} seconds` : ""}</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
