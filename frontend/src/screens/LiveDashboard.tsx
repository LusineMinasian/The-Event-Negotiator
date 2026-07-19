import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";
import { useCampaignSocket, WsEvent } from "../ws";
import { AreaChart, Bars, Candles, Donut } from "../charts";
import { fmtMoney } from "../money";
import { Avatar, PullMeToast, QuestionPrompt } from "../ui";
import CallDrawer from "./CallDrawer";
import AgentInfo from "./AgentInfo";
const CAT_COLORS = ["var(--brand)", "var(--good)", "var(--warn)", "#7a4fc0", "#2a5bd0"];

type Feed = { id: number; kind: string; text: string; accent?: string };
type Call = {
  call_id: string; vendor_name: string; category: string; phase: string; status: string;
  outcome?: string; last_line: string; opening?: number; total?: number;
  segment_display?: string; segment_key?: string; style?: string;
};

export default function LiveDashboard() {
  const { campaignId } = useParams();
  const [m, setM] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [calls, setCalls] = useState<Record<string, Call>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [liveUtterance, setLiveUtterance] = useState<any>(null);
  const [handoff, setHandoff] = useState<any>(null);
  const [question, setQuestion] = useState<any>(null);
  const fid = useRef(0);
  const refetchT = useRef<number | undefined>(undefined);
  const statusRef = useRef<string>("");

  useEffect(() => { clearTheme(); }, []);

  const load = () =>
    api.metrics(campaignId!).then((d) => { setM(d); statusRef.current = d.status; }).catch(() => {});
  const scheduleRefetch = () => {
    window.clearTimeout(refetchT.current);
    refetchT.current = window.setTimeout(load, 350);
  };

  useEffect(() => {
    load();
    api.elevenlabsStatus().then(setConn).catch(() => {});
    const poll = window.setInterval(() => {
      if (statusRef.current !== "completed") load();
    }, 4000);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const push = (kind: string, text: string, accent?: string) =>
    setFeed((f) => [{ id: fid.current++, kind, text, accent }, ...f].slice(0, 60));

  const upd = (id: string, patch: Partial<Call>) =>
    setCalls((c) => (c[id] ? { ...c, [id]: { ...c[id], ...patch } } : c));

  const handle = (e: WsEvent) => {
    const p = e.payload;
    switch (e.type) {
      case "call.initiated":
        setCalls((c) => ({ ...c, [p.call_id]: {
          call_id: p.call_id, vendor_name: p.vendor_name, category: p.category,
          phase: "dialing", status: "in_progress", last_line: "",
          segment_display: p.segment_display, segment_key: p.segment_key, style: p.style } }));
        push("call", `Dialing ${p.vendor_name} · ${p.category}`); scheduleRefetch(); break;
      case "call.phase": upd(p.call_id, { phase: p.phase }); break;
      case "call.live": upd(p.call_id, { phase: "live" }); push("live", `☎ Live call connected · ${p.vendor_name}`, "var(--good)"); break;
      case "utterance":
        upd(p.call_id, { last_line: `${p.speaker === "agent" ? "🤖" : p.speaker === "vendor" ? "🏬" : "•"} ${p.text}` });
        setLiveUtterance({ call_id: p.call_id, text: p.text, speaker: p.speaker });
        break;
      case "quote.new": upd(p.call_id, { opening: p.opening_total, total: p.total });
        push("quote", `New quote · ${p.vendor_name} · ${money(p.total)}`); scheduleRefetch(); break;
      case "quote.update": upd(p.call_id, { opening: p.opening_total, total: p.total }); break;
      case "price.move": upd(p.call_id, { total: p.to_total });
        push("move", `${p.vendor_name} ${money(p.from_total)} → ${money(p.to_total)} · ${p.leverage}`, "var(--good)");
        scheduleRefetch(); break;
      case "segment.reclassified":
        upd(p.call_id, { segment_display: p.segment_display, segment_key: p.to_segment });
        push("reclass", `Reclassified → ${p.segment_display}`, "#7a4fc0"); scheduleRefetch(); break;
      case "handoff.requested": setHandoff(p); push("handoff", `Pull-me-in · ${p.vendor_name}`, "var(--bad)"); break;
      case "handoff.resolved": setHandoff(null); push("handoff", `Handoff resolved (${p.resolved_by})`); break;
      case "question.asked": setQuestion(p); push("q", `Your call needed · ${p.vendor_name}`, "var(--brand)"); break;
      case "question.resolved": setQuestion(null); push("q", `Answered (${p.answer}) · agent bargaining`, "var(--brand)"); scheduleRefetch(); break;
      case "call.ended": upd(p.call_id, { status: "completed", outcome: p.outcome, phase: "closed" }); scheduleRefetch(); break;
      case "campaign.completed": push("done", "Campaign complete — receipt ready", "var(--good)"); load(); break;
    }
  };
  const { connected } = useCampaignSocket(campaignId!, handle);

  const resolveHandoff = async () => {
    if (handoff) await api.resolveHandoff(campaignId!, handoff.call_id);
    setHandoff(null);
  };
  const answerQuestion = async (key: string) => {
    const q = question; setQuestion(null);
    if (q) { try { await api.resolveQuestion(campaignId!, q.call_id, key); } catch { /* noop */ } }
  };

  // cumulative savings curve from ordered price moves (server truth, refreshes on poll)
  const curve = useMemo(() => {
    const moves: any[] = m?.price_moves || [];
    let acc = 0;
    return moves.map((mv) => (acc += Math.max(0, mv.from - mv.to)));
  }, [m]);
  // per-move saving amounts — drives the little "trading" candlestick ticker
  const ticker = useMemo(
    () => (m?.price_moves || []).map((mv: any) => Math.max(0, mv.from - mv.to)),
    [m],
  );

  const k = m?.kpi;
  const currency = m?.currency || "USD";
  const money = (n?: number) => fmtMoney(n, currency);
  const done = m?.status === "completed";
  const outcomes: Record<string, number> = m?.outcomes || {};
  const outcomeSegs = [
    { label: "Quotes", value: outcomes.quote || 0, color: "var(--good)" },
    { label: "Callbacks", value: outcomes.callback || 0, color: "var(--warn)" },
    { label: "Unreachable", value: outcomes.unreachable || 0, color: "var(--muted)" },
    { label: "In progress", value: k?.calls_active || 0, color: "var(--brand)" },
  ];
  const catRows = (m?.savings_by_category || []).map((c: any, i: number) => ({
    label: c.category, value: c.saved, color: CAT_COLORS[i % CAT_COLORS.length],
    caption: `${money(c.current)} of ${money(c.opening)}`,
  }));
  const levRows = (m?.leverage || []).filter((l: any) => l.moved > 0).slice(0, 6).map((l: any) => ({
    label: l.display, value: l.avg_saving_pct, color: "var(--brand)",
    caption: `moved ${l.moved}/${l.applied}`,
  }));
  const callList = Object.values(calls);

  return (
    <div className="container wide">
      <div className="dash-head">
        <div>
          <h1>Live Command Center</h1>
          <p className="sub">Every call, quote and price move as the fleet works the market — live.</p>
        </div>
        <div className="dash-head-actions">
          <span className={`chip ${connected ? "live" : "sim"}`}>{connected ? "● live feed" : "○ connecting"}</span>
          <Link className="btn ghost sm" to={`/campaign/${campaignId}/warroom`}>War Room →</Link>
          {done && <Link className="btn sm" to={`/campaign/${campaignId}/receipt`}>View receipt →</Link>}
        </div>
      </div>

      {conn && (
        <div className={`connector ${conn.connected ? "ok" : "sim"}`}>
          <div className="connector-dot" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>
              ElevenLabs Agents · {conn.call_mode === "live" ? "Live calling" : "Simulation mode"}
            </div>
            <div className="small">
              {conn.connected
                ? `Connected${conn.agent_name ? ` · agent “${conn.agent_name}”` : ""}${conn.phone_numbers?.length ? ` · ${conn.phone_numbers.length} number(s)` : ""}`
                : conn.error || "No API key set — calls run on the deterministic counterparty engine."}
            </div>
          </div>
          <span className={`chip ${conn.connected ? "live" : "sim"}`}>{conn.connected ? "● connected" : "● simulation"}</span>
        </div>
      )}

      <div className="kpi-grid">
        <Kpi n={k ? `${k.calls_active}` : "—"} l="Active calls" sub={k ? `${k.calls_completed} completed` : ""} />
        <Kpi n={k ? `${k.quotes}` : "—"} l="Quotes secured" />
        <Kpi n={k ? money(k.total_saved) : "—"} l="Negotiated down" sub="across all calls" accent="var(--good)" />
        <Kpi n={k ? `${k.avg_saving_pct}%` : "—"} l="Avg reduction" accent="var(--good)" />
        <Kpi n={k ? `${k.budget.pct}%` : "—"} l="Budget used"
             sub={k ? `${money(k.budget.spent)} / ${money(k.budget.ceiling)}` : ""}
             accent={k?.budget.over ? "var(--bad)" : undefined} />
        <Kpi n={k ? `${k.red_flags}` : "—"} l="Red flags" accent={k?.red_flags ? "var(--warn)" : undefined} />
      </div>

      <div className="dash-cols">
        <div className="dash-left">
          <div className="card pad">
            <div className="card-head">
              <h3>Live calls</h3>
              <span className="small">{callList.length ? `${callList.filter((c) => c.status !== "completed").length} active · click to open` : ""}</span>
            </div>
            <div className="calls-grid">
              {callList.length === 0 && <div className="small">Placing calls…</div>}
              {callList.map((c) => (
                <button key={c.call_id} className={`call-tile ${c.status === "completed" ? c.outcome : "active"}`}
                        onClick={() => setSelected(c.call_id)} style={{ textAlign: "left" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={c.vendor_name} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{c.vendor_name}</div>
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="phase-badge">{c.status === "completed" ? (c.outcome || "done") : c.phase}</span>
                        {c.style && <span className={`style-tag style-${c.style}`}>{c.style}</span>}
                        <AgentInfo segmentKey={c.segment_key} style={c.style} />
                      </span>
                    </div>
                    <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                      {c.opening && c.total && c.total < c.opening && (
                        <span className="small" style={{ textDecoration: "line-through", marginRight: 4 }}>{money(c.opening)}</span>
                      )}
                      {money(c.total)}
                    </span>
                  </div>
                  <div className="last-line">{c.last_line}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card pad">
            <div className="card-head">
              <h3>Negotiation movement</h3>
              <span className="mono" style={{ fontWeight: 700, color: "var(--good)", fontSize: 18 }}>
                {money(k?.total_saved)}
              </span>
            </div>
            <AreaChart points={curve} stroke="var(--good)" />
            <div className="small" style={{ marginTop: 6 }}>
              {curve.length} price moves landed · avg {k?.avg_saving_pct ?? 0}% off opening
            </div>

            <div className="ticker">
              <div className="ticker-head">
                <span className="ticker-sym">SAV·USD</span>
                <span className="ticker-chg up">▲ {k?.avg_saving_pct ?? 0}%</span>
                <span className="small ticker-note">per-call savings</span>
              </div>
              <Candles series={ticker} />
            </div>
          </div>

          <div className="grid cols-2">
            <div className="card pad">
              <h3>Negotiated by category</h3>
              <Bars rows={catRows} format={money} />
            </div>
            <div className="card pad">
              <h3>Leverage effectiveness</h3>
              <Bars rows={levRows} format={(n) => `${n}%`} />
            </div>
          </div>

          <div className="grid cols-2">
            <div className="card pad">
              <h3>Call outcomes</h3>
              <div className="donut-wrap">
                <Donut segments={outcomeSegs} centerLabel={`${k?.calls_total ?? 0}`} centerSub="calls" />
                <div className="legend">
                  {outcomeSegs.map((s) => (
                    <div key={s.label} className="legend-row">
                      <span className="legend-dot" style={{ background: s.color }} />
                      <span>{s.label}</span><span className="spacer" />
                      <span className="mono">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="card pad">
              <h3>Budget guard</h3>
              <div className="budget-num">
                <span className="mono">{money(k?.budget.spent)}</span>
                <span className="small"> / {money(k?.budget.ceiling)}</span>
              </div>
              <div className={`budget-bar ${k?.budget.over ? "over" : ""}`}>
                <span style={{ width: `${Math.min(100, k?.budget.pct || 0)}%` }} />
              </div>
              <div className="small" style={{ marginBottom: 14 }}>
                {k?.budget.over ? "Over category ceilings — see handoffs" : "Within budget"}
              </div>
              <h3>Coverage</h3>
              {(m?.coverage || []).map((c: any) => (
                <div key={c.category} className="cov-row">
                  <span style={{ textTransform: "capitalize" }}>{c.category}</span>
                  <div className="conf-bar" style={{ width: 90 }}>
                    <span style={{ width: `${(c.done / Math.max(c.total, 1)) * 100}%` }} />
                  </div>
                  <span className="mono small">{c.done}/{c.total}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-right">
          <div className="card pad feed-card">
            <div className="card-head"><h3>Live feed</h3>
              <span className="small">{feed.length}</span></div>
            <div className="feed">
              {feed.length === 0 && (
                <div className="small flex items-center gap-2 py-3">
                  <span className="animate-pulse2 rounded-full" style={{ width: 8, height: 8, background: "var(--brand)", boxShadow: "0 0 0 4px color-mix(in srgb, var(--brand) 16%, transparent)" }} />
                  Waiting for the first event…
                </div>
              )}
              {feed.map((f) => (
                <div key={f.id} className="feed-row flash">
                  <span className="feed-dot" style={{ background: f.accent || "var(--muted)" }} />
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {handoff && <PullMeToast vendor={handoff.vendor_name} detail={handoff.detail} onResolve={resolveHandoff} />}
      {question && <QuestionPrompt q={question} onAnswer={answerQuestion} />}

      {selected && (
        <CallDrawer campaignId={campaignId!} callId={selected} live={liveUtterance}
                    currency={currency} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Kpi({ n, l, sub, accent }: { n: string; l: string; sub?: string; accent?: string }) {
  return (
    <div className="card pad kpi">
      <div className="kpi-n" style={accent ? { color: accent } : undefined}>{n}</div>
      <div className="kpi-l">{l}</div>
      {sub && <div className="small">{sub}</div>}
    </div>
  );
}
