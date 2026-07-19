import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";

const EMOJI: Record<string, string> = { wedding: "💍", birthday: "🎂", baby_shower: "🍼", hackathon: "💻", public_speaking: "🎤", concert: "🎶" };

export default function Dashboard() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  useEffect(() => {
    clearTheme();
    api.listEvents().then((r) => setEvents(r.events)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h1>Your events</h1>
          <p className="sub mb-0">Each event runs the full loop: intake → calls → negotiation → ranked receipt.</p>
        </div>
        <button className="btn lg" onClick={() => nav("/new")}>
          <span className="text-lg leading-none">+</span> Create event
        </button>
      </div>

      {loading ? (
        <div className="grid cols-3 mt-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card pad h-[132px] animate-pulse"
                 style={{ background: "linear-gradient(100deg, #f1f3f9, #f7f9fc, #f1f3f9)" }} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="card empty-state mt-6">
          <div className="empty-emoji">🎉</div>
          <h2 className="mb-1">No events yet</h2>
          <p className="sub max-w-sm">Create an event, describe the vibe, and let the fleet call the market for you.</p>
          <button className="btn lg mt-2" onClick={() => nav("/new")}>Create your first event →</button>
        </div>
      ) : (
        <div className="grid cols-3 mt-6">
          {events.map((e) => (
            <Link key={e.id} to={`/spec/${e.spec_id}`} className="card pad no-underline group">
              <div className="flex items-start justify-between">
                <div className="text-[30px]">{EMOJI[e.type] || "🎉"}</div>
                <span className={`chip ${e.confirmed ? "live" : ""}`}>{e.confirmed ? "confirmed" : "draft"}</span>
              </div>
              <h3 className="mt-3 capitalize">{e.type.replace("_", " ")}</h3>
              <div className="small">{e.region_profile.toUpperCase()}</div>
              <div className="mt-3 text-sm font-semibold flex items-center gap-1 transition-transform group-hover:translate-x-1"
                   style={{ color: "var(--brand)" }}>
                Open <span aria-hidden>→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
