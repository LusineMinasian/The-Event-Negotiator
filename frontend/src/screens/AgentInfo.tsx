import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";

// One-line "why we talk to it this way" per counterparty style.
const STYLE_DESC: Record<string, string> = {
  stonewaller: "Reluctant to quote over the phone — opens up to a concrete, low-commitment ask.",
  upseller: "Pushes premium add-ons and upgrades — anchor on scope and challenge every fee.",
  lowballer: "Opens low then piles on fees — probe for hidden charges before committing.",
  hard: "Firm negotiator — moves on verified competing bids, volume and off-peak timing.",
  warm: "Relationship-driven and flexible — bundles and repeat business unlock discounts.",
  flexible: "Open to moving — relationship framing and off-peak slots create room.",
};

// segment catalog is small and static per session — fetch once, cache.
let _cache: any[] | null = null;
async function getSegment(key: string) {
  if (!_cache) {
    try { _cache = (await api.segments()).segments; } catch { _cache = []; }
  }
  return _cache!.find((s: any) => s.key === key) || null;
}

const cap = (s?: string) => (s || "").replace(/_/g, " ");

// Load a segment by key (cached across the session).
function useSegment(key?: string) {
  const [seg, setSeg] = useState<any>(null);
  useEffect(() => {
    let live = true;
    if (key) getSegment(key).then((s) => { if (live) setSeg(s); });
    else setSeg(null);
    return () => { live = false; };
  }, [key]);
  return seg;
}

// Read-only "why this agent" content, shared by the popover and the inline panel.
// `behavior` (optional) reflects the user's live overrides so pushed/muted levers show.
function AgentBrief({ seg, style, confidence, behavior }:
  { seg: any; style?: string; confidence?: number; behavior?: { prioritized: string[]; muted: string[] } }) {
  const rp = seg?.resistance_profile || {};
  const prioritized = behavior?.prioritized || [];
  const muted = behavior?.muted || [];
  const levers = [...(seg.levers || [])]
    .filter((l: any) => !muted.includes(l.key))
    .sort((a, b) => (prioritized.includes(b.key) ? 1 : 0) - (prioritized.includes(a.key) ? 1 : 0)
      || (b.weight || 0) - (a.weight || 0))
    .slice(0, 6);
  return (
    <>
      <div className="agent-pop-head">
        <b>{seg.display_name}</b>
        {style && <span className={`style-tag style-${style}`}>{style}</span>}
      </div>
      {confidence != null && <div className="small">Matched with {Math.round(confidence * 100)}% confidence</div>}
      {style && STYLE_DESC[style] && <p className="agent-pop-desc">{STYLE_DESC[style]}</p>}
      <div className="agent-pop-meta">Priced <b>{cap(seg.pricing_model)}</b> · decided by <b>{cap(seg.decision_maker)}</b></div>
      {levers.length > 0 && (
        <div className="agent-pop-sec">
          <div className="agent-pop-label">Levers that work</div>
          <div>{levers.map((l: any) => (
            <span key={l.key} className={`pill lev ${prioritized.includes(l.key) ? "star" : ""}`}>
              {prioritized.includes(l.key) ? "★ " : ""}{cap(l.key)}
            </span>
          ))}</div>
        </div>
      )}
      {seg.levers_harmful?.length > 0 && (
        <div className="agent-pop-sec">
          <div className="agent-pop-label">Avoid — never raise</div>
          <div>{seg.levers_harmful.map((h: any) =>
            <span key={h.key} className="pill harm" title={h.reason}>✕ {cap(h.key)}</span>)}</div>
        </div>
      )}
      <div className="small agent-pop-foot">
        Concession ceiling ~{Math.round((rp.typical_concession_ceiling || 0) * 100)}% ·
        opening markup ~{Math.round((rp.opening_markup_expected || 0) * 100)}%
      </div>
    </>
  );
}

// A small "ⓘ" that explains which agent/segment was picked for a vendor and why.
// The popover is rendered through a portal to <body> so a `position:fixed` box is
// anchored to the viewport even when a parent (drawer/animated card) has a transform.
export default function AgentInfo({ segmentKey, style, confidence }:
  { segmentKey?: string; style?: string; confidence?: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const seg = useSegment(open ? segmentKey : undefined);
  const btnRef = useRef<HTMLSpanElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 8, window.innerWidth - 292)) });
  };

  const toggle = (e: any) => {
    e.stopPropagation(); e.preventDefault();
    if (open) { setOpen(false); return; }
    place();          // position synchronously so it appears in the right spot first time
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: any) => { if (!(e.target.closest && e.target.closest(".agent-pop, .info-btn"))) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!segmentKey) return null;

  return (
    <>
      <span ref={btnRef} className="info-btn" role="button" tabIndex={0} title="Why this agent?"
            onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}>i</span>
      {open && pos && createPortal(
        <div className="agent-pop" style={{ position: "fixed", top: pos.top, left: pos.left }}
             onMouseDown={(e) => e.stopPropagation()}>
          {seg ? <AgentBrief seg={seg} style={style} confidence={confidence} />
               : <div className="small">Loading agent…</div>}
        </div>,
        document.body,
      )}
    </>
  );
}

// Full inline "Recommended agent" card for the call drawer, with an editor that
// lets the user push levers first or mute them — persisted to the backend so it
// actually changes how the agent negotiates on the next calls.
export function AgentPanel({ segmentKey, style, confidence }:
  { segmentKey?: string; style?: string; confidence?: number }) {
  const seg = useSegment(segmentKey);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [beh, setBeh] = useState<{ prioritized: string[]; muted: string[] }>({ prioritized: [], muted: [] });

  useEffect(() => {
    if (!segmentKey) return;
    api.behaviorGet(segmentKey)
      .then((b) => setBeh({ prioritized: b.prioritized || [], muted: b.muted || [] }))
      .catch(() => {});
  }, [segmentKey]);

  if (!segmentKey || !seg) return null;

  const toggleIn = (list: "prioritized" | "muted", key: string) => {
    setSaved(false);
    setBeh((b) => {
      const has = b[list].includes(key);
      const next = { prioritized: [...b.prioritized], muted: [...b.muted] };
      // pushing and muting are mutually exclusive
      const other = list === "prioritized" ? "muted" : "prioritized";
      next[other] = next[other].filter((k) => k !== key);
      next[list] = has ? next[list].filter((k) => k !== key) : [...next[list], key];
      return next;
    });
  };

  const save = async () => {
    if (!segmentKey) return;
    setSaving(true);
    try { await api.behaviorSet(segmentKey, beh); setSaved(true); setEditing(false); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    if (!segmentKey) return;
    setSaving(true);
    try { await api.behaviorClear(segmentKey); setBeh({ prioritized: [], muted: [] }); setSaved(true); }
    finally { setSaving(false); }
  };

  const edited = beh.prioritized.length > 0 || beh.muted.length > 0;

  return (
    <div className="card pad agent-panel">
      <div className="agent-panel-top">
        <h3 style={{ margin: 0 }}>Recommended agent</h3>
        <button className="btn ghost sm" onClick={() => { setEditing((v) => !v); setSaved(false); }}>
          {editing ? "Done" : "✎ Edit behavior"}
        </button>
      </div>

      <AgentBrief seg={seg} style={style} confidence={confidence} behavior={beh} />

      {editing && (
        <div className="agent-edit">
          <div className="agent-pop-label" style={{ marginTop: 4 }}>Tune the levers this agent uses</div>
          <div className="small" style={{ marginBottom: 10 }}>Push a lever to the front, or mute it. Changes apply to the next calls.</div>
          {(seg.levers || []).map((l: any) => {
            const pushed = beh.prioritized.includes(l.key);
            const muted = beh.muted.includes(l.key);
            return (
              <div className={`lever-row ${muted ? "muted" : ""}`} key={l.key}>
                <span className="lever-name">{cap(l.key)}</span>
                <div className="lever-acts">
                  <button className={`chip ${pushed ? "on" : ""}`} onClick={() => toggleIn("prioritized", l.key)}>★ Push first</button>
                  <button className={`chip ${muted ? "on danger" : ""}`} onClick={() => toggleIn("muted", l.key)}>✕ Mute</button>
                </div>
              </div>
            );
          })}
          <div className="agent-edit-foot">
            <button className="btn ghost sm" onClick={reset} disabled={saving || !edited}>Reset</button>
            <button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save behavior"}</button>
          </div>
        </div>
      )}
      {saved && !editing && <div className="small agent-saved">✓ Saved — the agent will use this on the next calls.</div>}
    </div>
  );
}
