import { useEffect, useRef, useState } from "react";
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

// A small "ⓘ" that explains which agent/segment was picked for a vendor and why.
export default function AgentInfo({ segmentKey, style, confidence }:
  { segmentKey?: string; style?: string; confidence?: number }) {
  const [open, setOpen] = useState(false);
  const [seg, setSeg] = useState<any>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);

  const toggle = async (e: any) => {
    e.stopPropagation(); e.preventDefault();
    if (open) { setOpen(false); return; }
    if (!seg) setSeg(await getSegment(segmentKey!));
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 8, window.innerWidth - 292)) });
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
  const rp = seg?.resistance_profile || {};

  return (
    <>
      <span ref={btnRef} className="info-btn" role="button" tabIndex={0} title="Why this agent?"
            onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}>i</span>
      {open && seg && pos && (
        <div className="agent-pop" style={{ position: "fixed", top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          <div className="agent-pop-head">
            <b>{seg.display_name}</b>
            {style && <span className={`style-tag style-${style}`}>{style}</span>}
          </div>
          {confidence != null && <div className="small">Matched with {Math.round(confidence * 100)}% confidence</div>}
          {style && STYLE_DESC[style] && <p className="agent-pop-desc">{STYLE_DESC[style]}</p>}
          <div className="agent-pop-meta">Priced <b>{cap(seg.pricing_model)}</b> · decided by <b>{cap(seg.decision_maker)}</b></div>
          {seg.levers?.length > 0 && (
            <div className="agent-pop-sec">
              <div className="agent-pop-label">Levers that work</div>
              <div>{[...seg.levers].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 6)
                .map((l: any) => <span key={l.key} className="pill lev">{cap(l.key)}</span>)}</div>
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
        </div>
      )}
    </>
  );
}
