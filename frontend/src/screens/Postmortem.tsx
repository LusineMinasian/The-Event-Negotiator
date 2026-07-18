import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";
import { Loading } from "../ui";

export default function Postmortem() {
  const { campaignId } = useParams();
  const [pm, setPm] = useState<any>(null);
  useEffect(() => {
    clearTheme();
    api.postmortem(campaignId!).then(setPm);
  }, [campaignId]);
  if (!pm) return <Loading label="Analyzing the campaign…" />;

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <div className="section-eyebrow">Transparency</div>
      <h1>Agent postmortem</h1>
      <p className="sub">The honest part: what worked, what didn't, and where the sample was thin. Admitting the gaps
        reads as maturity, not weakness.</p>

      <div className="grid cols-3">
        <div className="card pad stat"><span className="n">{pm.calls_with_price_movement}/{pm.total_calls}</span><span className="l">calls with price movement</span></div>
        <div className="card pad stat"><span className="n">{pm.reclassifications.length}</span><span className="l">in-call reclassifications</span></div>
        <div className="card pad stat"><span className="n">{pm.honesty_violations}</span><span className="l">honesty violations (fabricated bids)</span></div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card pad">
          <h3>Call outcomes</h3>
          {Object.entries(pm.outcomes).map(([k, v]: any) => (
            <div className="li-row" key={k}><span style={{ textTransform: "capitalize" }}>{k}</span><span className="mono">{v}</span></div>
          ))}
        </div>
        <div className="card pad">
          <h3>Coverage by category</h3>
          {Object.entries(pm.coverage).map(([k, v]: any) => (
            <div className="li-row" key={k}><span style={{ textTransform: "capitalize" }}>{k}</span><span className="mono">{v} calls</span></div>
          ))}
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 16 }}>
        <h3>Lever effectiveness by segment</h3>
        <p className="small">Learned from this campaign's observations. Initial lever weights are hypotheses the system refines — not measured truths.</p>
        {pm.lever_effectiveness.length === 0 && <div className="small">No lever data yet.</div>}
        {pm.lever_effectiveness.map((l: any, i: number) => (
          <div className="li-row" key={i}>
            <span>{l.segment.split("__")[1]} · <b>{l.lever}</b></span>
            <span className="mono">{l.moved}/{l.applied} moved · avg {l.avg_delta_pct}%</span>
          </div>
        ))}
      </div>

      {pm.reclassifications.length > 0 && (
        <div className="card pad" style={{ marginTop: 16 }}>
          <h3>Reclassifications (pre-call classifier was wrong)</h3>
          {pm.reclassifications.map((r: any, i: number) => (
            <div className="li-row" key={i}><span>{r.from.split("__")[1]} → {r.to.split("__")[1]}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
