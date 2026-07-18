import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { applyTheme } from "../palette";
import { Stepper, Loading } from "../ui";

export default function VibeToSpec() {
  const { specId } = useParams();
  const nav = useNavigate();
  const [payload, setPayload] = useState<any>(null);
  const [palette, setPalette] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getSpec(specId!).then((s) => {
      setPayload(s.payload);
      setPalette(s.payload.style?.palette || []);
      applyTheme(s.theme_tokens);
      if (s.confirmed) nav(`/spec/${specId}/discovery`);
    });
  }, [specId]);

  const save = async (next: any) => {
    setPayload(next);
    await api.patchSpec(specId!, {
      event: next.event, location: next.location, budget: next.budget,
    });
  };

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const r = await api.uploadBoard(specId!, f);
      setPalette(r.palette);
      applyTheme(r.theme_tokens);
    } finally {
      setBusy(false);
    }
  };

  if (!payload) return <Loading label="Loading your spec…" />;
  const ev = payload.event, loc = payload.location, bud = payload.budget;
  const sym = bud.currency === "USD" ? "$" : bud.currency + " ";

  return (
    <div className="container themed">
      <Stepper step={2} />
      <h1>Review &amp; complete your spec</h1>
      <p className="sub">Your voice intake already seeded the palette and the vibe. Add more inspiration if you like,
        then fill in the last details on the right — every path writes one structured job spec.</p>

      <div className="two-pane">
        <div>
          <div className="dropzone" onClick={() => fileRef.current?.click()}
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
            <input ref={fileRef} type="file" accept="image/*" hidden
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <div style={{ fontSize: 30 }}>🎨</div>
            <div style={{ marginTop: 8, fontWeight: 600, color: "var(--ink)" }}>
              {busy ? "Reading your board…" : "Drop an inspiration board"}
            </div>
            <div className="small">PNG / JPG — palette extracted on device</div>
            {palette.length > 0 && (
              <div className="swatches" style={{ justifyContent: "center" }}>
                {palette.map((p, i) => (
                  <div className="swatch" key={i}>
                    <span className="dot" style={{ background: p.hex }} /> {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card pad" style={{ marginTop: 16 }}>
            <h3>Where this came from</h3>
            <p className="small">The palette and vibe here were captured in the voice studio (step 1) — by the
              browser recognizer, or the ElevenLabs intake agent when live. Drop another board above to blend
              in more colors; everything merges into the same spec.</p>
          </div>
        </div>

        <div className="card pad">
          <h2>Job spec</h2>
          <div className="field">
            <label>Guest count</label>
            <input type="number" value={ev.guest_count}
                   onChange={(e) => save({ ...payload, event: { ...ev, guest_count: +e.target.value } })} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={ev.date}
                   onChange={(e) => save({ ...payload, event: { ...ev, date: e.target.value } })} />
          </div>
          <div className="field">
            <label>City</label>
            <input value={loc.city}
                   onChange={(e) => save({ ...payload, location: { ...loc, city: e.target.value } })} />
          </div>
          <div className="field">
            <label>Budget ceiling ({bud.currency})</label>
            <input type="number" value={bud.total_ceiling}
                   onChange={(e) => save({ ...payload, budget: { ...bud, total_ceiling: +e.target.value } })} />
          </div>
          {payload.intake && ((payload.intake.keywords?.length || 0) > 0 || (payload.intake.colors?.length || 0) > 0) && (
            <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="small" style={{ marginBottom: 6 }}>From your voice intake</div>
              <div className="bubble-grid">
                {(payload.intake.colors || []).map((hex: string, i: number) => (
                  <span key={`c${i}`} className="bubble color" style={{ background: hex, padding: "4px 10px", fontSize: 12 }}>{hex}</span>
                ))}
                {(payload.intake.keywords || []).map((k: string, i: number) => (
                  <span key={`k${i}`} className="bubble" style={{ padding: "4px 10px", fontSize: 12 }}><span style={{ opacity: 0.5 }}>#</span>{k}</span>
                ))}
              </div>
            </div>
          )}
          <div className="spec-row"><span>Categories</span><span>{payload.categories.map((c: any) => c.key).join(", ")}</span></div>
          <div className="spec-row"><span>Region</span><span>{loc.region_profile.toUpperCase()}</span></div>
          <div className="spec-row"><span>Est. per guest</span>
            <span className="mono">{sym}{Math.round(bud.total_ceiling / Math.max(ev.guest_count, 1))}</span></div>
          <button className="btn lg accent" style={{ marginTop: 16, width: "100%", justifyContent: "center" }}
                  onClick={() => nav(`/spec/${specId}/confirm`)}>Continue to confirm →</button>
        </div>
      </div>
    </div>
  );
}
