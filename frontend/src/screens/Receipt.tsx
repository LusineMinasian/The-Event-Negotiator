import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { applyTheme } from "../palette";
import { Loading } from "../ui";
import { fmtMoney, fromUsd } from "../money";

export default function Receipt() {
  const { campaignId } = useParams();
  const [r, setR] = useState<any>(null);

  useEffect(() => {
    api.receipt(campaignId!).then((d) => { setR(d); applyTheme(d.theme_tokens); });
  }, [campaignId]);

  if (!r) return <Loading label="Building the receipt…" />;

  const cur = r.currency || "USD";
  const money = (n?: number) => fmtMoney(n, cur);
  const loc = (n?: number) => Math.round(fromUsd(n || 0, cur)); // amounts in the chosen currency for the CSV

  const downloadCsv = () => {
    const rows: (string | number)[][] = [[
      "Category", "Vendor", "Contact", "Phone", "Rating", "Segment",
      `Opening (${cur})`, `Negotiated (${cur})`, `Saved (${cur})`, "Change %", "Recommended", "Leverage",
    ]];
    Object.entries(r.categories).forEach(([cat, items]: any) =>
      items.forEach((it: any) => {
        const saved = loc((it.opening_total || 0) - (it.negotiated_subtotal ?? it.total));
        rows.push([cat, it.vendor, it.contact || "", it.phone || "", it.rating, it.segment_display,
          loc(it.opening_total), loc(it.total), saved, it.delta_pct,
          it.rank === 1 ? "yes" : "no", (it.leverage_used || []).join("; ")]);
      }));
    rows.push([]);
    rows.push(["", "", "", "", "", "RECOMMENDED TOTAL", "", loc(r.recommended_total)]);
    rows.push(["", "", "", "", "", "BUDGET CEILING", "", loc(r.budget_ceiling || 0)]);
    rows.push(["", "", "", "", "", "NEGOTIATED DOWN", "", loc(r.savings)]);
    const csv = rows.map((row) => row.map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `estimate-${r.event.type}-${r.event.date || "event"}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="container themed">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2" style={{ maxWidth: 560, margin: "0 auto 12px" }}>
        <span className="section-eyebrow" style={{ margin: 0 }}>Final estimate</span>
        <div className="flex gap-2">
          <button className="btn ghost sm" onClick={downloadCsv}>⤓ CSV</button>
          <Link className="btn ghost sm" to={`/campaign/${campaignId}/postmortem`}>Postmortem →</Link>
        </div>
      </div>

      <div className="rcpt">
        <div className="rcpt-brand">THE&nbsp;NEGOTIATOR</div>
        <div className="rcpt-meta">
          {r.event.type.replace("_", " ")} · {r.event.date} · {r.location.city} · {r.event.guest_count} guests
        </div>
        <div className="rcpt-meta faint">spec {r.spec_hash} · {Object.keys(r.categories).length} categories</div>

        <div className="rcpt-save">
          <span>You save</span>
          <b className="mono">{money(r.savings)}</b>
        </div>

        {Object.entries(r.categories).map(([cat, items]: any) => (
          <div key={cat} className="rcpt-catblock">
            <div className="rcpt-cat">{cat}</div>
            {items.map((it: any, i: number) => (
              <div key={i} className={`rcpt-item ${it.rank === 1 ? "pick" : ""}`}>
                <div className="rcpt-line1">
                  <span className="rcpt-vname">
                    {it.vendor}{it.rank === 1 && <span className="rcpt-pick">pick</span>}
                  </span>
                  <span className="rcpt-price">
                    {Math.round(it.negotiated_subtotal) !== Math.round(it.opening_total) && (
                      <span className="was mono">{money(it.opening_total)}</span>
                    )}
                    <span className="now mono">{money(it.total)}</span>
                  </span>
                </div>
                <div className="rcpt-sub">
                  sold by <b>{it.contact}</b> · ★{it.rating} · {it.segment_display}
                  {it.delta_pct < 0 && <> · <span className="off">{it.delta_pct}%</span></>}
                </div>
                {it.rank === 1 && it.leverage_used?.length > 0 && (
                  <div className="rcpt-sub faint">levers: {it.leverage_used.join(", ")}</div>
                )}
                {it.rank === 1 && it.line_items?.map((li: any, j: number) => (
                  <div className="rcpt-li" key={j}>
                    <span>{li.label}{li.disclosed_voluntarily === false && <span className="rcpt-hidden">hidden</span>}</span>
                    <span className="dots" /><span className="mono">{money(li.amount)}</span>
                  </div>
                ))}
                {it.red_flags?.map((f: any, j: number) => (
                  <div key={j} className={`rcpt-flag ${f.severity}`}>⚑ {f.rule.replace(/_/g, " ")}: {f.detail}</div>
                ))}
              </div>
            ))}
          </div>
        ))}

        <div className="rcpt-total">
          <div className="rcpt-trow big"><span>RECOMMENDED TOTAL</span><span className="mono">{money(r.recommended_total)}</span></div>
          <div className="rcpt-trow"><span>Budget ceiling</span><span className="mono">{money(r.budget_ceiling)}</span></div>
          <div className="rcpt-trow"><span>Negotiated down</span><span className="mono save">−{money(r.savings)}</span></div>
        </div>
        <div className="rcpt-foot">{r.time_ledger.calls} calls · {r.time_ledger.phone_time} of phone time saved · thank you ✦</div>
      </div>
    </div>
  );
}
