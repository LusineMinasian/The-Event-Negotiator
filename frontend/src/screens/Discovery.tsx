import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";

export default function Discovery() {
  const { specId } = useParams();
  const nav = useNavigate();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    clearTheme();
    api.discover(specId!, 4).then((r) => {
      setCampaignId(r.campaign_id);
      setVendors(r.vendors);
      setBusy(false);
    });
  }, [specId]);

  const toggle = async (v: any) => {
    await api.patchVendor(v.id, { excluded: !v.excluded });
    setVendors((vs) => vs.map((x) => (x.id === v.id ? { ...x, excluded: !x.excluded } : x)));
  };

  const start = async () => {
    await api.startCampaign(campaignId!);
    nav(`/campaign/${campaignId}/warroom`);
  };

  const byCat: Record<string, any[]> = {};
  vendors.forEach((v) => (byCat[v.category] ||= []).push(v));
  const active = vendors.filter((v) => !v.excluded).length;

  return (
    <div className="container">
      <div className="stepper">
        <span className="s">1</span><span>›</span><span className="s">2</span><span>›</span><span className="s">3</span><span>›</span>
        <span className="s active">4 · Discovery</span><span>›</span><span className="s">5</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Market discovery</h1>
          <p className="sub">The call list is built programmatically and stratified by segment — so the sample spans
            cheap and premium, rigid and flexible operators. Each vendor is pre-classified into a segment.</p>
        </div>
        <button className="btn lg" onClick={start} disabled={busy || active === 0}>
          Start calling {active} vendors →
        </button>
      </div>

      {busy ? (
        <div className="center">Searching the market…</div>
      ) : (
        Object.entries(byCat).map(([cat, vs]) => (
          <div key={cat} style={{ marginTop: 20 }}>
            <h2 style={{ textTransform: "capitalize" }}>{cat}</h2>
            <div className="card">
              {vs.map((v) => (
                <div className="vendor-row" key={v.id} style={{ opacity: v.excluded ? 0.5 : 1 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{v.name}</div>
                    <div className="small">★ {v.rating} · {v.review_count} reviews · {v.distance_km} km</div>
                  </div>
                  <span className="seg-tag">{v.segment_display}</span>
                  {v.style && <span className={`style-tag style-${v.style}`}>{v.style}</span>}
                  <div title={`confidence ${Math.round(v.segment_confidence * 100)}%`}>
                    <div className="conf-bar"><span style={{ width: `${v.segment_confidence * 100}%` }} /></div>
                  </div>
                  <button className="btn ghost sm" onClick={() => toggle(v)}>{v.excluded ? "Include" : "Exclude"}</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
