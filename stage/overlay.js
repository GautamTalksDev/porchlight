// Injected into every page the autopilot shows. Draws the stage cursor, the click ripple,
// the spotlight and the crossfade cover, and forwards the presenter's control keys.
// Written with inline styles only, so it works under any content security policy.
(() => {
  if (window.__stage) return;
  const Z = 2147483000;
  const state = { x: -100, y: -100, raf: 0, visible: false };
  let root, cursor, ripple, spot, cover;

  function el(tag, style) {
    const e = document.createElement(tag);
    Object.assign(e.style, style);
    return e;
  }

  function mount() {
    if (root || !document.body) return;
    root = el("div", { position: "fixed", inset: "0", pointerEvents: "none", zIndex: String(Z) });
    spot = el("div", {
      position: "fixed", left: "0", top: "0", width: "0", height: "0", borderRadius: "16px",
      boxShadow: "0 0 0 9999px rgba(4, 5, 13, 0.58)", outline: "2px solid rgba(255, 213, 150, 0.55)",
      outlineOffset: "4px", opacity: "0", transition: "all 380ms cubic-bezier(0.16, 1, 0.3, 1)",
    });
    ripple = el("div", {
      position: "fixed", left: "0", top: "0", width: "44px", height: "44px", marginLeft: "-22px", marginTop: "-22px",
      borderRadius: "50%", border: "2px solid #f4b560", opacity: "0", transform: "scale(0.4)",
    });
    cursor = el("div", { position: "fixed", left: "0", top: "0", width: "28px", height: "28px", opacity: "0", transition: "opacity 260ms ease", filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.55))" });
    cursor.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17.5 L13.6 25.5 L17 24 L13.4 16.2 L20.5 16.2 Z" fill="#ffffff" stroke="#0a0d1f" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    cover = el("div", { position: "fixed", inset: "0", background: "#04050d", opacity: "0", transition: "opacity 260ms ease" });
    root.append(spot, ripple, cursor, cover);
    document.documentElement.appendChild(root);
    document.documentElement.style.cursor = "none";
    place();
  }

  function place() {
    if (cursor) cursor.style.transform = `translate(${state.x - 5}px, ${state.y - 3}px)`;
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  window.__stage = {
    moveTo(x, y, ms = 750) {
      mount();
      cancelAnimationFrame(state.raf);
      const x0 = state.x < 0 ? x - 160 : state.x;
      const y0 = state.y < 0 ? y + 120 : state.y;
      const start = performance.now();
      // A gentle arc, like a hand moving a mouse.
      const bend = Math.min(60, Math.hypot(x - x0, y - y0) * 0.12);
      return new Promise((resolve) => {
        const step = (now) => {
          const k = Math.min(1, (now - start) / ms);
          const e = ease(k);
          state.x = x0 + (x - x0) * e;
          state.y = y0 + (y - y0) * e - Math.sin(Math.PI * e) * bend;
          place();
          if (k < 1) state.raf = requestAnimationFrame(step);
          else resolve();
        };
        state.raf = requestAnimationFrame(step);
      });
    },
    showCursor(on) {
      mount();
      state.visible = on;
      cursor.style.opacity = on ? "1" : "0";
    },
    click() {
      mount();
      ripple.style.left = `${state.x}px`;
      ripple.style.top = `${state.y}px`;
      ripple.animate(
        [
          { opacity: 0.95, transform: "scale(0.35)" },
          { opacity: 0, transform: "scale(1.6)" },
        ],
        { duration: 480, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
      cursor.animate([{ transform: cursor.style.transform + " scale(1)" }, { transform: cursor.style.transform + " scale(0.86)" }, { transform: cursor.style.transform + " scale(1)" }], { duration: 220 });
    },
    spotlight(rect) {
      mount();
      if (!rect) {
        spot.style.opacity = "0";
        return;
      }
      const pad = 10;
      Object.assign(spot.style, {
        left: `${rect.x - pad}px`, top: `${rect.y - pad}px`,
        width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`, opacity: "1",
      });
    },
    cover(opacity, ms = 260) {
      mount();
      cover.style.transition = `opacity ${ms}ms ease`;
      cover.style.opacity = String(opacity);
    },
  };

  // The presenter's keys: Space pauses, right arrow skips, F is the fallback, Q quits.
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key;
      if (k === " " || k === "ArrowRight" || k === "f" || k === "F" || k === "q" || k === "Q") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof window.__stageKey === "function") window.__stageKey(k.toLowerCase());
      }
    },
    true,
  );

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
