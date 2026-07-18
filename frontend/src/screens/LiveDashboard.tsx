import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";
import { useCampaignSocket, WsEvent } from "../ws";
import { AreaChart, Bars, Donut } from "../charts";

const money = (n?: number) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());
const CAT_COLORS = ["var(--brand)", "var(--good)", "var(--warn)", "#7a4fc0", "#2a5bd0"];

type Feed = { id: number; kind: string; text: string; accent?: string };

export default function LiveDashboard() {
  const { campaignId } = useParams();
  const [m, setM] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [handoff, setHandoff] = useState<any>(null);
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

  const handle = (e: WsEvent) => {
    const p = e.payload;
    switch (e.type) {
      case "call.initiated": push("call", `Dialing ${p.vendor_name} · ${p.category}`); scheduleRefetch(); break;
      case "call.live": push("live", `☎ Live call connected · ${p.vendor_name}`, "var(--good)"); break;
      case "quote.new": push("quote", `New quote · ${p.vendor_name} · ${money(p.total)}`); scheduleRefetch(); break;
      case "price.move":
        push("move", `${p.vendor_name} ${money(p.from_total)} → ${money(p.to_total)} · ${p.leverage}`, "var(--good)");
        scheduleRefetch(); break;
      case "segment.reclassified": push("reclass", `Reclassified → ${p.segment_display}`, "#7a4fc0"); scheduleRefetch(); break;
      case "handoff.requested": setHandoff(p); push("handoff", `Pull-me-in · ${p.vendor_name}`, "var(--bad)"); break;
      case "handoff.resolved": setHandoff(null); push("handoff", `Handoff resolved (${p.resolved_by})`); break;
      case "call.ended": scheduleRefetch(); break;
      case "campaign.completed": push("done", "Campaign complete — receipt ready", "var(--good)"); load(); break;
    }
  };
  const { connected } = useCampaignSocket(campaignId!, handle);

  const resolveHandoff = async () => {
    if (handoff) await api.resolveHandoff(campaignId!, handoff.call_id);
    setHandoff(null);
  };

  // cumulative savings curve from ordered price moves (server truth, refreshes on poll)
  const curve = useMemo(() => {
    const moves: any[] = m?.price_moves || [];
    let acc = 0;
    return moves.map((mv) => (acc += Math.max(0, mv.from - mv.to)));
  }, [m]);

  const k = m?.kpi;
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
              <h3>Negotiation movement</h3>
              <span className="mono" style={{ fontWeight: 700, color: "var(--good)", fontSize: 18 }}>
                {money(k?.total_saved)}
              </span>
            </div>
            <AreaChart points={curve} stroke="var(--good)" />
            <div className="small" style={{ marginTop: 6 }}>
              {curve.length} price moves landed · avg {k?.avg_saving_pct ?? 0}% off opening
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

      {handoff && (
        <button className="btn accent lg pullme" style={{ background: "var(--bad)" }} onClick={resolveHandoff}>
          🔴 Pull me in — {handoff.vendor_name} ({handoff.detail})
        </button>
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
