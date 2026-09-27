"use client";

import { useImperativeHandle, useRef, useState, forwardRef } from "react";

export type NoticeSeverity = "info" | "urgent";

export interface NoticeView {
  id: string;
  en: string;
  fr: string;
  severity: NoticeSeverity;
  at: number;
  reachedNodes: number;
  totalNodes: number;
}

export interface NoticesApi {
  openWithEnglish: (en: string) => Promise<{ ok: boolean; frFilled: boolean; model?: string; error?: string }>;
  sendCurrent: () => Promise<{ ok: boolean; reason?: string }>;
  getDraft: () => { en: string; fr: string; severity: NoticeSeverity };
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export const NoticesPanel = forwardRef<
  NoticesApi,
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    notices: NoticeView[];
    onSent: () => void;
  }
>(function NoticesPanel({ open, onOpenChange, notices, onSent }, ref) {
  const [en, setEn] = useState("");
  const [fr, setFr] = useState("");
  const [severity, setSeverity] = useState<NoticeSeverity>("info");
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const enRef = useRef(en);
  const frRef = useRef(fr);
  const severityRef = useRef(severity);
  const onOpenChangeRef = useRef(onOpenChange);
  const onSentRef = useRef(onSent);
  const sendingRef = useRef(false);
  enRef.current = en;
  frRef.current = fr;
  severityRef.current = severity;
  onOpenChangeRef.current = onOpenChange;
  onSentRef.current = onSent;

  /** Always posts the latest trimmed English (from the argument, or the live ref). */
  const translate = async (english?: string) => {
    const text = (english ?? enRef.current).trim();
    if (!text) {
      const reason = "English text is required";
      setTranslateError(reason);
      setModelNote(null);
      return { ok: false as const, frFilled: false, error: reason };
    }
    setBusy(true);
    setTranslateError(null);
    try {
      const r = await post("/api/notices/translate", { en: text });
      if (!r.ok) {
        const reason = String(r.data.reason ?? "Gemini is unavailable");
        setTranslateError(reason);
        setModelNote(null);
        return { ok: false as const, frFilled: false, error: reason };
      }
      const drafted = String(r.data.fr ?? "");
      frRef.current = drafted;
      setFr(drafted);
      setModelNote(`Drafted by ${r.data.model}. Check it before sending.`);
      return { ok: true as const, frFilled: true, model: String(r.data.model ?? "") };
    } catch {
      const reason = "Could not reach the translate service. Type the French version to send.";
      setTranslateError(reason);
      setModelNote(null);
      return { ok: false as const, frFilled: false, error: reason };
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (sendingRef.current) {
      return { ok: false as const, reason: "Send already in progress" };
    }
    const enT = enRef.current.trim();
    const frT = frRef.current.trim();
    if (!enT || !frT) {
      return {
        ok: false as const,
        reason: !enT && !frT ? "English and French are both required" : !enT ? "English is missing" : "French is missing",
      };
    }
    sendingRef.current = true;
    setBusy(true);
    try {
      const r = await post("/api/notices", { en: enT, fr: frT, severity: severityRef.current });
      if (!r.ok) return { ok: false as const, reason: String(r.data.reason ?? "Could not send") };
      enRef.current = "";
      frRef.current = "";
      setEn("");
      setFr("");
      setModelNote(null);
      setTranslateError(null);
      onSentRef.current();
      return { ok: true as const };
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    openWithEnglish: async (text: string) => {
      onOpenChangeRef.current(true);
      enRef.current = text;
      setEn(text);
      frRef.current = "";
      setFr("");
      setModelNote(null);
      setTranslateError(null);
      return translate(text);
    },
    sendCurrent: () => send(),
    getDraft: () => ({ en: enRef.current, fr: frRef.current, severity: severityRef.current }),
  }));

  if (!open) return null;

  const canDraft = Boolean(en.trim()) && !busy;
  const canSend = Boolean(en.trim() && fr.trim()) && !busy;

  return (
    <div className="notices-panel" role="dialog" aria-label="City notices">
      <div className="preflight-head">
        <h2 className="section-title">Notices</h2>
        <button className="btn btn-quiet btn-small" type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>

      <label className="notice-field" htmlFor="notice-en">
        English
        <textarea
          id="notice-en"
          rows={3}
          maxLength={280}
          value={en}
          onChange={(e) => {
            enRef.current = e.target.value;
            setEn(e.target.value);
          }}
          placeholder="What should the street hear?"
        />
        <span className="notice-count">{en.length} / 280</span>
      </label>

      <div className="row">
        <button
          className="btn btn-quiet btn-small"
          type="button"
          onClick={() => void translate()}
          disabled={!canDraft}
        >
          Draft French
        </button>
      </div>
      {translateError ? <p className="section-sub">{translateError}</p> : null}
      {modelNote ? <p className="section-sub">{modelNote}</p> : null}

      <label className="notice-field" htmlFor="notice-fr">
        French
        <textarea
          id="notice-fr"
          rows={3}
          maxLength={320}
          value={fr}
          onChange={(e) => {
            frRef.current = e.target.value;
            setFr(e.target.value);
          }}
          placeholder="Version française"
        />
        <span className="notice-count">{fr.length} / 320</span>
      </label>

      <fieldset className="notice-severity">
        <legend>Severity</legend>
        <label>
          <input type="radio" name="severity" checked={severity === "info"} onChange={() => setSeverity("info")} />
          Information
        </label>
        <label>
          <input type="radio" name="severity" checked={severity === "urgent"} onChange={() => setSeverity("urgent")} />
          Urgent
        </label>
      </fieldset>

      <button className="btn btn-porch" type="button" disabled={!canSend} onClick={() => void send()}>
        Send to the street
      </button>

      <h3 className="section-title">Sent</h3>
      {notices.length ? (
        <ul className="notice-sent-list">
          {notices.map((n) => {
            const openFr = expanded.has(n.id);
            return (
              <li key={n.id} data-severity={n.severity}>
                <p className="notice-sent-en">{n.en}</p>
                {openFr ? <p className="section-sub">{n.fr}</p> : null}
                <p className="call-meta">
                  {clock(n.at)} · {n.severity === "urgent" ? "Urgent" : "Information"} · Reached {n.reachedNodes} of{" "}
                  {n.totalNodes} nodes
                </p>
                <button
                  className="btn btn-quiet btn-small"
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    })
                  }
                >
                  {openFr ? "Hide French" : "Show French"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="section-sub">No notices sent yet.</p>
      )}
    </div>
  );
});
