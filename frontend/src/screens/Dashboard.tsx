import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";

const EMOJI: Record<string, string> = { wedding: "💍", birthday: "🎂", baby_shower: "🍼" };

export default function Dashboard() {
  const [events, setEvents] = useState<any[]>([]);
  const nav = useNavigate();
  useEffect(() => {
    clearTheme();
    api.listEvents().then((r) => setEvents(r.events)).catch(() => {});
  }, []);

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Your events</h1>
          <p className="sub">Each event runs the full loop: intake → calls → negotiation → ranked receipt.</p>
        </div>
        <button className="btn lg" onClick={() => nav("/new")}>+ New negotiation</button>
      </div>

      {events.length === 0 ? (
        <div className="card pad" style={{ marginTop: 20, textAlign: "center", color: "var(--muted)" }}>
          No events yet. Start your first negotiation.
        </div>
      ) : (
        <div className="grid cols-3" style={{ marginTop: 20 }}>
          {events.map((e) => (
            <Link key={e.id} to={`/spec/${e.spec_id}`} className="card pad" style={{ textDecoration: "none" }}>
              <div style={{ fontSize: 30 }}>{EMOJI[e.type] || "🎉"}</div>
              <h3 style={{ marginTop: 8, textTransform: "capitalize" }}>{e.type.replace("_", " ")}</h3>
              <div className="small">{e.region_profile.toUpperCase()} · {e.confirmed ? "confirmed" : "draft"}</div>
              <div className="chip" style={{ marginTop: 10, display: "inline-block" }}>{e.status}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
