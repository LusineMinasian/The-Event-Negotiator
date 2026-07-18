import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { applyTheme } from "../palette";

export default function Confirm() {
  const { specId } = useParams();
  const nav = useNavigate();
  const [spec, setSpec] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSpec(specId!).then((s) => {
      setSpec(s);
      applyTheme(s.theme_tokens);
    });
  }, [specId]);

  const confirm = async () => {
    setErr(""); setBusy(true);
    try {
      await api.confirmSpec(specId!);
      nav(`/spec/${specId}/discovery`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!spec) return <div className="center">Loading…</div>;
  const p = spec.payload;
  const sym = p.budget.currency === "USD" ? "$" : p.budget.currency + " ";

  return (
    <div className="container themed" style={{ maxWidth: 820 }}>
      <div className="stepper">
        <span className="s">1</span><span>›</span><span className="s">2</span><span>›</span>
        <span className="s active">3 · Confirm</span><span>›</span><span className="s">4</span><span>›</span><span className="s">5</span>
      </div>
      <h1>Confirm the job spec</h1>
      <p className="sub">Once confirmed, the spec is frozen and hashed. Every call describes exactly this — verbatim.</p>

      <div className="card pad">
        <div className="spec-row"><span>Event</span><span style={{ textTransform: "capitalize" }}>{p.event.type.replace("_", " ")} · {p.event.date}</span></div>
        <div className="spec-row"><span>Guests</span><span className="mono">{p.event.guest_count}</span></div>
        <div className="spec-row"><span>Location</span><span>{p.location.city} · {p.location.region_profile.toUpperCase()}</span></div>
        <div className="spec-row"><span>Budget ceiling</span><span className="mono">{sym}{p.budget.total_ceiling.toLocaleString()}</span></div>
      </div>

      <h2 style={{ marginTop: 24 }}>Budget allocation</h2>
      <div className="card pad">
        {Object.entries(p.budget.allocation).map(([cat, frac]: any) => (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ textTransform: "capitalize" }}>{cat}</span>
              <span className="mono">{sym}{Math.round(p.budget.total_ceiling * frac).toLocaleString()} ({Math.round(frac * 100)}%)</span>
            </div>
            <div className="budget-bar"><span style={{ width: `${frac * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>Suggested segments per category</h2>
      <div className="grid cols-3">
        {p.categories.map((c: any) => (
          <div key={c.key} className="seg-card">
            <h3 style={{ textTransform: "capitalize" }}>{c.key}</h3>
            {c.segment_preferences?.preferred?.map((s: string) => <span key={s} className="pill lev">{s.split("__")[1]}</span>)}
            {c.segment_preferences?.excluded?.length > 0 && (
              <>
                <div className="small" style={{ marginTop: 8 }}>Excluded:</div>
                {c.segment_preferences.excluded.map((s: string) => <span key={s} className="pill harm">{s.split("__")[1]}</span>)}
                {c.segment_preferences.reason && <div className="small" style={{ marginTop: 6 }}>{c.segment_preferences.reason}</div>}
              </>
            )}
          </div>
        ))}
      </div>

      {err && <div className="err">{err}</div>}
      {spec.spec_hash && <div className="banner" style={{ marginTop: 20 }}>Frozen · spec_hash <span className="mono">{spec.spec_hash}</span></div>}
      <button className="btn lg accent" style={{ marginTop: 20 }} onClick={confirm} disabled={busy}>
        {busy ? "Freezing…" : "Confirm & freeze spec →"}
      </button>
    </div>
  );
}
