import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Avatar } from "../ui";
import { AgentPanel } from "./AgentInfo";
import { fmtMoney } from "../money";

export default function CallDrawer({ campaignId, callId, live, currency = "USD", onClose }: {
  campaignId: string; callId: string; live: any; currency?: string; onClose: () => void;
}) {
  const money = (n?: number) => fmtMoney(n, currency);
  const [data, setData] = useState<any>(null);
  const [utterances, setUtterances] = useState<any[]>([]);
  const [intervening, setIntervening] = useState(false);

  const load = () =>
    api.callDetail(campaignId, callId).then((d) => {
      setData(d);
      setUtterances(d.utterances);
    });

  useEffect(() => { load(); }, [callId]);

  // lock the background (dashboard) from scrolling while the drawer is open.
  // Restore to "" (the page default) on unmount so a lock can never leak and freeze the page.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // append live utterances for this call (newest is rendered on top, no auto-scroll)
  useEffect(() => {
    if (live && live.call_id === callId) {
      setUtterances((u) => [...u, { speaker: live.speaker, text: live.text, ts_s: 0, lever_key: "" }]);
    }
  }, [live]);

  const closed = data?.call && data.call.status === "completed";
  // poll only while the call is still live — a finished call never changes
  useEffect(() => {
    if (closed) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [callId, closed]);

  const q = data?.quote;
  // newest first — new phrases appear at the top instead of pushing the view down
  const feed = [...utterances].reverse();

  return createPortal((
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {/* pinned header — always visible, never scrolls away */}
        <div className="drawer-head">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={data?.vendor?.name || "Call"} />
              <div className="min-w-0">
                <h2 className="m-0 truncate">{data?.vendor?.name || "Call"}</h2>
                {data?.vendor && <div className="small"><span style={{ color: "var(--warn)" }}>★</span> {data.vendor.rating} · {data.vendor.review_count} reviews</div>}
              </div>
            </div>
            <button className="btn ghost sm" onClick={onClose}>Close</button>
          </div>
          {data?.call && (
            <div className="small" style={{ marginTop: 8 }}>
              {data.call.category} · {data.call.outcome || data.call.phase}
              {data.call.segment_at_start !== data.call.segment_final && (
                <> · segment <b>{data.call.segment_at_start.split("__")[1]}</b> → <b>{data.call.segment_final.split("__")[1]}</b></>
              )}
            </div>
          )}
        </div>

        {/* scrollable body */}
        <div className="drawer-body">
          {!closed && (
            intervening ? (
              <div className="banner" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <span className="animate-pulse2" aria-hidden>🎙</span>
                <span>You're stepping onto this call — manual takeover routing is coming soon.</span>
                <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setIntervening(false)}>Step out</button>
              </div>
            ) : (
              <button className="btn lg" style={{ width: "100%", justifyContent: "center", marginBottom: 14, background: "var(--bad)" }}
                      onClick={() => setIntervening(true)}>
                ✋ Intervene — take over this call
              </button>
            )
          )}

          {q && (
            <div className="card pad" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <h3>Quote</h3>
                <span className="mono" style={{ fontWeight: 700 }}>{money(q.total)}</span>
              </div>
              {q.line_items?.map((li: any, i: number) => (
                <div className="li-row" key={i}>
                  <span>{li.label}{li.disclosed_voluntarily === false && <span className="pill harm" style={{ marginLeft: 6 }}>hidden</span>}</span>
                  <span className="mono">{money(li.amount)}</span>
                </div>
              ))}
              {q.negotiation?.leverage_used?.length > 0 && (
                <div className="small" style={{ marginTop: 8 }}>
                  Levers: {q.negotiation.leverage_used.map((l: any) => l.display).join(", ")}
                  {q.negotiation.delta_pct != null && <> · <b style={{ color: "var(--good)" }}>{q.negotiation.delta_pct}%</b></>}
                </div>
              )}
              {q.red_flags?.map((f: any, i: number) => (
                <div key={i} className={`redflag ${f.severity}`}>⚑ {f.rule.replace(/_/g, " ")}: {f.detail}</div>
              ))}
            </div>
          )}

          <div className="card-head"><h3>Transcript</h3><span className="small">newest first</span></div>
          <div className="transcript">
            {feed.length === 0 && <div className="small">Waiting for the first line…</div>}
            {feed.map((u, i) => (
              <div key={feed.length - i} className={`utterance ${u.speaker} ${u.lever_key ? "lever" : ""}`}>
                <div className="who">{u.speaker}{u.lever_key ? ` · lever: ${u.lever_key}` : ""}</div>
                {u.text}
              </div>
            ))}
          </div>

          {data?.call?.segment_final && (
            <div style={{ marginTop: 14 }}>
              <AgentPanel segmentKey={data.call.segment_final} style={data.call.style} />
            </div>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
