import { useEffect, useState } from "react";
import { api } from "../api";
import { clearTheme } from "../palette";

// Client-side inference (spec 13.2) — five plain questions → a strategy.
function infer(a: Record<string, string>) {
  const levers: { key: string; why: string }[] = [];
  const harmful: { key: string; why: string }[] = [];
  if (a.perishable === "yes") levers.push({ key: "urgency", why: "an unfilled slot is lost revenue" });
  else harmful.push({ key: "urgency", why: "nothing is lost from an empty slot" });
  if (a.minorder === "yes") harmful.push({ key: "volume", why: "a small order sits below their minimum" });
  else levers.push({ key: "volume", why: "no minimum, so scale helps" });
  if (a.decision === "owner") levers.push({ key: "relationship", why: "the owner can grant a discount" });
  else { levers.push({ key: "manager_escalation", why: "the rep can't decide — escalate" }); harmful.push({ key: "relationship", why: "rapport doesn't move a rep" }); }
  if (a.pricing === "fixed") { harmful.push({ key: "competing_bid", why: "fixed grid ignores comparison" }); levers.push({ key: "scope_reduction", why: "only scope moves a fixed price" }); }
  else levers.push({ key: "tier_downgrade", why: "packages can be downgraded" });
  if (a.cost === "labor") levers.push({ key: "scope_reduction", why: "cutting labor scope cuts price proportionally" });
  if (a.cost === "materials") harmful.push({ key: "scope_reduction", why: "materials are already bought — no savings" });
  return { levers, harmful };
}

const Q = [
  { key: "decision", q: "Is it a company with a team, or a person working solo?", opts: [["owner", "Solo / owner"], ["employee", "Company with a team"]] },
  { key: "perishable", q: "If their date goes unbooked, is that income lost forever?", opts: [["yes", "Yes, lost forever"], ["no", "No"]] },
  { key: "minorder", q: "Do they have a minimum order?", opts: [["yes", "Yes"], ["no", "No"]] },
  { key: "pricing", q: "Is their price fixed on a list, or negotiable?", opts: [["fixed", "Fixed price list"], ["negotiable", "Negotiable / packages"]] },
  { key: "cost", q: "What's most expensive for them?", opts: [["materials", "Materials"], ["labor", "Labor"], ["rental", "Equipment rental"]] },
];

export default function SegmentStudio() {
  const [tab, setTab] = useState<"library" | "constructor">("library");
  const [segments, setSegments] = useState<any[]>([]);
  const [cat, setCat] = useState("catering");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => { clearTheme(); }, []);
  useEffect(() => { api.segments(cat).then((r) => setSegments(r.segments)); }, [cat]);

  const result = Object.keys(answers).length === Q.length ? infer(answers) : null;

  return (
    <div className="container">
      <h1>Segment Studio</h1>
      <p className="sub">A segment describes who you buy from — and that decides which negotiation is even possible.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === "library" ? "" : "ghost"} sm`} onClick={() => setTab("library")}>Library</button>
        <button className={`btn ${tab === "constructor" ? "" : "ghost"} sm`} onClick={() => setTab("constructor")}>Constructor</button>
      </div>

      {tab === "library" && (
        <>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 220, marginBottom: 16 }}>
            {["catering", "venue", "decor", "photo", "music"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="grid cols-3">
            {segments.map((s) => (
              <div key={s.key} className="seg-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3>{s.display_name}</h3>
                  {s.style && <span className={`style-tag style-${s.style}`}>{s.style}</span>}
                </div>
                <div className="small">{s.pricing_model} · decides: {s.decision_maker}</div>
                <div style={{ marginTop: 8 }}>
                  {s.levers?.slice(0, 4).map((l: any) => <span key={l.key} className="pill lev">{l.key}</span>)}
                </div>
                <div style={{ marginTop: 4 }}>
                  {s.levers_harmful?.map((h: any) => <span key={h.key} className="pill harm">✕ {h.key}</span>)}
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  ceiling {Math.round((s.resistance_profile?.typical_concession_ceiling || 0) * 100)}% ·
                  markup {Math.round((s.resistance_profile?.opening_markup_expected || 0) * 100)}%
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "constructor" && (
        <div className="two-pane">
          <div className="card pad">
            {Q.map((qq) => (
              <div key={qq.key} className="field">
                <label>{qq.q}</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {qq.opts.map(([v, l]) => (
                    <button key={v} className={`btn ${answers[qq.key] === v ? "" : "ghost"} sm`}
                            onClick={() => setAnswers((a) => ({ ...a, [qq.key]: v }))}>{l}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="card pad">
            <h3>Inferred strategy</h3>
            {!result && <div className="small">Answer all five to see the strategy.</div>}
            {result && (
              <>
                <h3 style={{ marginTop: 8, color: "var(--good)" }}>Levers</h3>
                {result.levers.map((l, i) => <div key={i} className="li-row"><b>{l.key}</b><span className="small">{l.why}</span></div>)}
                <h3 style={{ marginTop: 12, color: "var(--bad)" }}>Harmful — never raise</h3>
                {result.harmful.map((l, i) => <div key={i} className="li-row"><b>{l.key}</b><span className="small">{l.why}</span></div>)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
