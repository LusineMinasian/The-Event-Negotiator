import { useEffect, useState } from "react";
import { api } from "../api";
import { clearTheme } from "../palette";

function EventCol({ eventKey }: { eventKey: string }) {
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { api.eventConfig(eventKey).then(setCfg); }, [eventKey]);
  if (!cfg) return <div className="card pad">…</div>;
  return (
    <div className="card pad">
      <h2 style={{ textTransform: "capitalize" }}>{cfg.display_name}</h2>
      <h3>Ranking weights</h3>
      {Object.entries(cfg.default_ranking_weights || {}).map(([k, v]: any) => (
        <div className="li-row" key={k}><span>{k}</span><span className="mono">{v}</span></div>
      ))}
      <h3 style={{ marginTop: 12 }}>Base levers</h3>
      <div>{(cfg.base_levers || []).map((l: string) => <span key={l} className="pill lev">{l}</span>)}</div>
      <h3 style={{ marginTop: 12 }}>Harmful levers</h3>
      <div>{(cfg.base_levers_harmful || []).length === 0 ? <span className="small">none</span> :
        cfg.base_levers_harmful.map((h: any) => <span key={h.key} className="pill harm">{h.key}</span>)}</div>
      <h3 style={{ marginTop: 12 }}>Categories</h3>
      <div className="small">{(cfg.required_categories || []).join(", ")}</div>
    </div>
  );
}

export default function ConfigSwitch() {
  const [events, setEvents] = useState<any[]>([]);
  const [left, setLeft] = useState("baby_shower");
  const [right, setRight] = useState("wedding");
  useEffect(() => {
    clearTheme();
    api.meta().then((m) => setEvents(m.events));
  }, []);

  return (
    <div className="container">
      <h1>Config Switch</h1>
      <p className="sub">Vertical parameters are configuration, not code. The same engine runs every event —
        the levers, weights and harmful topics come from YAML. Swap the config, swap the market.</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <select value={left} onChange={(e) => setLeft(e.target.value)} style={{ maxWidth: 220 }}>
          {events.map((e) => <option key={e.key} value={e.key}>{e.display_name}</option>)}
        </select>
        <select value={right} onChange={(e) => setRight(e.target.value)} style={{ maxWidth: 220 }}>
          {events.map((e) => <option key={e.key} value={e.key}>{e.display_name}</option>)}
        </select>
      </div>
      <div className="diff-cols">
        <EventCol eventKey={left} />
        <EventCol eventKey={right} />
      </div>
    </div>
  );
}
