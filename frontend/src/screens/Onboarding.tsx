import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

const EMOJI: Record<string, string> = { wedding: "💍", birthday: "🎂", baby_shower: "🍼" };

export default function Onboarding() {
  const nav = useNavigate();
  const [events, setEvents] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [type, setType] = useState("baby_shower");
  const [region, setRegion] = useState("us_ca");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.meta().then((m) => {
      setEvents(m.events);
      setRegions(m.regions);
    });
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.createEvent(type, region);
      nav(`/spec/${r.spec_id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="stepper">
        <span className="s active">1 · Event</span><span>›</span>
        <span className="s">2 · Vibe</span><span>›</span>
        <span className="s">3 · Confirm</span><span>›</span>
        <span className="s">4 · Discovery</span><span>›</span>
        <span className="s">5 · War Room</span>
      </div>
      <h1>What are we planning?</h1>
      <p className="sub">The event type loads a different config — categories, ranking weights, negotiation levers. Same engine, swapped config.</p>

      <div className="event-cards">
        {events.map((e) => (
          <button key={e.key} className={`event-card ${type === e.key ? "selected" : ""}`} onClick={() => setType(e.key)}>
            <div className="event-emoji">{EMOJI[e.key] || "🎉"}</div>
            <h3 style={{ marginTop: 10 }}>{e.display_name}</h3>
            <div className="small">{e.required_categories.join(" · ")}</div>
            <div className="small" style={{ marginTop: 4 }}>~{e.typical_guest_range?.join("–")} guests</div>
          </button>
        ))}
      </div>

      <div className="card pad" style={{ marginTop: 20, maxWidth: 360 }}>
        <label>Region</label>
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          {regions.map((r) => (
            <option key={r.key} value={r.key}>{r.key.toUpperCase()} · {r.currency}</option>
          ))}
        </select>
        <button className="btn lg" style={{ marginTop: 16, width: "100%", justifyContent: "center" }} onClick={start} disabled={busy}>
          {busy ? "Creating…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
