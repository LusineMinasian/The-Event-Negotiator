import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { applyTheme } from "../palette";

const money = (n?: number) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

export default function Receipt() {
  const { campaignId } = useParams();
  const [r, setR] = useState<any>(null);

  useEffect(() => {
    api.receipt(campaignId!).then((d) => {
      setR(d);
      applyTheme(d.theme_tokens);
    });
  }, [campaignId]);

  if (!r) return <div className="center">Building the receipt…</div>;

  return (
    <div className="container themed">
      <div className="receipt">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>The Receipt</h1>
          <Link className="btn ghost" to={`/campaign/${campaignId}/postmortem`}>Agent postmortem →</Link>
        </div>

        <div className="card pad" style={{ marginTop: 12 }}>
          <div className="receipt-head">
            <div style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
              {r.event.type.replace("_", " ")} · {r.event.date} · {r.location.city} · {r.event.guest_count} guests
            </div>
            <div className="small">spec_hash {r.spec_hash} · {Object.keys(r.categories).length} categories</div>
          </div>

          {Object.entries(r.categories).map(([cat, items]: any) => (
            <div key={cat} style={{ marginBottom: 6 }}>
              <h3 style={{ textTransform: "uppercase", color: "var(--muted)", fontSize: 12, letterSpacing: "0.05em" }}>{cat}</h3>
              {items.map((it: any, i: number) => (
                <div key={i} className="receipt-line">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{it.vendor}</span> <span className="small">★{it.rating} ({it.review_count})</span>
                      {it.rank === 1 && <span className="picked" style={{ marginLeft: 8 }}>recommended</span>}
                      <div className="small">{it.segment_display}
                        {it.delta_pct < 0 && <> · <b style={{ color: "var(--good)" }}>{it.delta_pct}%</b> via {it.leverage_used.join(", ")}</>}
                      </div>
                      {it.trigger_utterance && <div className="small" style={{ fontStyle: "italic", marginTop: 2 }}>“{it.trigger_utterance}”</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {it.negotiated_subtotal !== it.opening_total && (
                        <span className="small mono" style={{ textDecoration: "line-through", marginRight: 6 }}>{money(it.opening_total)}</span>
                      )}
                      <span className="mono" style={{ fontWeight: 700 }}>{money(it.total)}</span>
                    </div>
                  </div>
                  {it.rank === 1 && it.line_items?.map((li: any, j: number) => (
                    <div className="li-row" key={j}>
                      <span>{li.label}{li.disclosed_voluntarily === false && <span className="pill harm" style={{ marginLeft: 6 }}>hidden</span>}</span>
                      <span className="mono">{money(li.amount)}</span>
                    </div>
                  ))}
                  {it.red_flags?.map((f: any, j: number) => (
                    <div key={j} className={`redflag ${f.severity}`}>⚑ {f.rule.replace(/_/g, " ")}: {f.detail}</div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          <div className="receipt-head" style={{ borderBottom: "none", borderTop: "2px dashed var(--line)", paddingTop: 14, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>RECOMMENDED TOTAL</span><span className="mono">{money(r.recommended_total)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }} className="small">
              <span>Budget ceiling</span><span className="mono">{money(r.budget_ceiling)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }} className="small">
              <span>Negotiated down by</span><span className="mono" style={{ color: "var(--good)" }}>{money(r.savings)}</span>
            </div>
          </div>
        </div>

        <div className="grid cols-3" style={{ marginTop: 16 }}>
          <div className="card pad stat"><span className="n">{r.time_ledger.calls}</span><span className="l">calls placed</span></div>
          <div className="card pad stat"><span className="n">{r.time_ledger.phone_time}</span><span className="l">phone time saved</span></div>
          <div className="card pad stat"><span className="n mono">{money(r.savings)}</span><span className="l">negotiated off the top</span></div>
        </div>
      </div>
    </div>
  );
}
