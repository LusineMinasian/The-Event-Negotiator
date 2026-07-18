import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";
import { useCampaignSocket, WsEvent } from "../ws";
import { PullMeToast } from "../ui";
import CallDrawer from "./CallDrawer";

type Call = {
  call_id: string; vendor_name: string; category: string; phase: string; status: string;
  outcome?: string; segment_display: string; style?: string; last_line: string;
  rating: number; review_count: number; opening?: number; total?: number;
};

const money = (n?: number) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

export default function WarRoom() {
  const { campaignId } = useParams();
  const [calls, setCalls] = useState<Record<string, Call>>({});
  const [ticker, setTicker] = useState<any[]>([]);
  const [budget, setBudget] = useState<any>(null);
  const [status, setStatus] = useState("running");
  const [handoff, setHandoff] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [liveUtterance, setLiveUtterance] = useState<{ call_id: string; text: string; speaker: string } | null>(null);
  const tid = useRef(0);

  useEffect(() => { clearTheme(); }, []);

  const handle = (e: WsEvent) => {
    const p = e.payload;
    switch (e.type) {
      case "call.initiated":
        setCalls((c) => ({ ...c, [p.call_id]: {
          call_id: p.call_id, vendor_name: p.vendor_name, category: p.category, phase: "dialing",
          status: "in_progress", segment_display: p.segment_display, style: p.style,
          last_line: "", rating: p.rating, review_count: p.review_count } }));
        break;
      case "call.phase":
        setCalls((c) => c[p.call_id] ? { ...c, [p.call_id]: { ...c[p.call_id], phase: p.phase } } : c);
        break;
      case "utterance":
        setCalls((c) => c[p.call_id] ? { ...c, [p.call_id]: { ...c[p.call_id],
          last_line: `${p.speaker === "agent" ? "🤖" : p.speaker === "vendor" ? "🏬" : "•"} ${p.text}` } } : c);
        setLiveUtterance({ call_id: p.call_id, text: p.text, speaker: p.speaker });
        break;
      case "quote.new":
      case "quote.update":
        setCalls((c) => c[p.call_id] ? { ...c, [p.call_id]: { ...c[p.call_id], opening: p.opening_total, total: p.total } } : c);
        if (e.type === "quote.new")
          setTicker((t) => [{ id: tid.current++, kind: "new", vendor: p.vendor_name, total: p.total, category: p.category }, ...t].slice(0, 40));
        break;
      case "price.move":
        setCalls((c) => c[p.call_id] ? { ...c, [p.call_id]: { ...c[p.call_id], total: p.to_total } } : c);
        setTicker((t) => [{ id: tid.current++, kind: "move", vendor: p.vendor_name, from: p.from_total,
          to: p.to_total, delta: p.delta_pct, leverage: p.leverage }, ...t].slice(0, 40));
        break;
      case "segment.reclassified":
        setCalls((c) => c[p.call_id] ? { ...c, [p.call_id]: { ...c[p.call_id], segment_display: p.segment_display } } : c);
        setTicker((t) => [{ id: tid.current++, kind: "reclass", vendor: calls[p.call_id]?.vendor_name, note: p.note, seg: p.segment_display }, ...t].slice(0, 40));
        break;
      case "call.ended":
        setCalls((c) => c[p.call_id] ? { ...c, [p.call_id]: { ...c[p.call_id], status: "completed", outcome: p.outcome, phase: "closed" } } : c);
        break;
      case "handoff.requested":
        setHandoff(p);
        break;
      case "handoff.resolved":
        setHandoff(null);
        break;
      case "campaign.completed":
        setBudget(p.budget);
        setStatus("completed");
        break;
    }
  };

  const { connected } = useCampaignSocket(campaignId!, handle);

  const resolveHandoff = async () => {
    if (handoff) await api.resolveHandoff(campaignId!, handoff.call_id);
    setHandoff(null);
  };

  const callList = Object.values(calls);
  const byCat: Record<string, Call[]> = {};
  callList.forEach((c) => (byCat[c.category] ||= []).push(c));

  return (
    <div className="container wide">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>War Room</h1>
          <p className="sub">Live calls against distinct negotiation styles. Watch prices move when leverage lands.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className={`chip ${connected ? "live" : "sim"}`}>{connected ? "● connected" : "○ connecting"}</span>
          <Link className="btn ghost sm" to={`/campaign/${campaignId}/live`}>← Dashboard</Link>
          {status === "completed" && <Link className="btn" to={`/campaign/${campaignId}/receipt`}>View receipt →</Link>}
        </div>
      </div>

      <div className="warroom" style={{ marginTop: 12 }}>
        <div>
          {Object.entries(byCat).map(([cat, cs]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <h3 style={{ textTransform: "capitalize", color: "var(--muted)" }}>{cat}</h3>
              <div className="calls-grid">
                {cs.map((c) => (
                  <div key={c.call_id} className={`call-tile ${c.status === "completed" ? c.outcome : "active"}`}
                       onClick={() => setSelected(c.call_id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.vendor_name}</div>
                        <span className="seg-tag">{c.segment_display}</span>
                      </div>
                      {c.style && <span className={`style-tag style-${c.style}`}>{c.style}</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                      <span className="phase-badge">{c.status === "completed" ? (c.outcome || "done") : c.phase}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {c.opening && c.total && c.total < c.opening && (
                          <span className="small" style={{ textDecoration: "line-through", marginRight: 6 }}>{money(c.opening)}</span>
                        )}
                        {money(c.total)}
                      </span>
                    </div>
                    <div className="last-line">{c.last_line}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {callList.length === 0 && <div className="center">Placing calls…</div>}
        </div>

        <div>
          <div className="card pad">
            <h3>Live price ticker</h3>
            <div className="ticker">
              {ticker.length === 0 && <div className="small">Waiting for the first quote…</div>}
              {ticker.map((t) => (
                <div key={t.id} className="ticker-row flash">
                  {t.kind === "new" && <><span className="seg-tag">{t.category}</span><b>{t.vendor}</b><span className="spacer" /><span className="mono">{money(t.total)}</span></>}
                  {t.kind === "move" && <><b>{t.vendor}</b><span className="small">{t.leverage}</span><span className="spacer" /><span className="mono small" style={{ textDecoration: "line-through" }}>{money(t.from)}</span><span className="mono">{money(t.to)}</span><span className={`delta ${t.delta < 0 ? "down" : "up"}`}>{t.delta}%</span></>}
                  {t.kind === "reclass" && <><span className="style-tag style-flexible">reclassified</span><b>{t.vendor}</b> → {t.seg}</>}
                </div>
              ))}
            </div>
          </div>

          {budget && (
            <div className="card pad" style={{ marginTop: 16 }}>
              <h3>Budget guard</h3>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Spent</span><span className="mono">{money(budget.spent)} / {money(budget.ceiling)}</span>
              </div>
              <div className={`budget-bar ${budget.overrun_pct > 0 ? "over" : ""}`}>
                <span style={{ width: `${Math.min(100, (budget.spent / budget.ceiling) * 100)}%` }} />
              </div>
              <div className="small">Action: {budget.action.replace(/_/g, " ")}</div>
            </div>
          )}
        </div>
      </div>

      {handoff && <PullMeToast vendor={handoff.vendor_name} detail={handoff.detail} onResolve={resolveHandoff} />}

      {selected && (
        <CallDrawer campaignId={campaignId!} callId={selected} live={liveUtterance}
                    onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
