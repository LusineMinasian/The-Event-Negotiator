import { useEffect, useState } from "react";
import { api } from "../api";
import { Avatar } from "../ui";

const money = (n?: number) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

export default function CallDrawer({ campaignId, callId, live, onClose }: {
  campaignId: string; callId: string; live: any; onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [utterances, setUtterances] = useState<any[]>([]);
  const [intervening, setIntervening] = useState(false);

  const load = () =>
    api.callDetail(campaignId, callId).then((d) => {
      setData(d);
      setUtterances(d.utterances);
    });

  useEffect(() => { load(); }, [callId]);

  // append live utterances for this call (newest is rendered on top, no auto-scroll)
  useEffect(() => {
    if (live && live.call_id === callId) {
      setUtterances((u) => [...u, { speaker: live.speaker, text: live.text, ts_s: 0, lever_key: "" }]);
    }
  }, [live]);

  useEffect(() => {
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [callId]);

  const q = data?.quote;
  const closed = data?.call && data.call.status === "completed";
  // newest first — new phrases appear at the top instead of pushing the view down
  const feed = [...utterances].reverse();
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="flex items-center gap-3">
            <Avatar name={data?.vendor?.name || "Call"} />
            <div>
              <h2 className="m-0">{data?.vendor?.name || "Call"}</h2>
              {data?.vendor && <div className="small"><span style={{ color: "var(--warn)" }}>★</span> {data.vendor.rating} · {data.vendor.review_count} reviews</div>}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {data?.call && (
          <div className="small" style={{ marginBottom: 10 }}>
            {data.call.category} · {data.call.outcome || data.call.phase}
            {data.call.segment_at_start !== data.call.segment_final && (
              <> · segment <b>{data.call.segment_at_start.split("__")[1]}</b> → <b>{data.call.segment_final.split("__")[1]}</b></>
            )}
          </div>
        )}

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
            <div key={feed.length - i} className={`utterance ${u.speaker} ${u.lever_key ? "lever" : ""} ${i === 0 ? "flash" : ""}`}>
              <div className="who">{u.speaker}{u.lever_key ? ` · lever: ${u.lever_key}` : ""}</div>
              {u.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
