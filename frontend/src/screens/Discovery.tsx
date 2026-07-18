import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { clearTheme } from "../palette";
import { Stepper, Avatar, Skeleton } from "../ui";

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
    nav(`/campaign/${campaignId}/live`);
  };

  const byCat: Record<string, any[]> = {};
  vendors.forEach((v) => (byCat[v.category] ||= []).push(v));
  const active = vendors.filter((v) => !v.excluded).length;
  const segments = new Set(vendors.map((v) => v.segment_display)).size;

  return (
    <div className="container">
      <Stepper step={4} />
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div className="max-w-2xl">
          <div className="section-eyebrow">Step 4 · The call list</div>
          <h1>Market discovery</h1>
          <p className="sub mb-0">The call list is built programmatically and stratified by segment — so the sample spans
            cheap and premium, rigid and flexible operators. Each vendor is pre-classified into a segment.</p>
        </div>
        <button className="btn lg" onClick={start} disabled={busy || active === 0}>
          Start calling {active} vendors →
        </button>
      </div>

      {busy ? (
        <>
          <div className="small mt-6 mb-3 flex items-center gap-2">
            <span className="spinner" style={{ width: 16, height: 16 }} /> Searching the market and classifying vendors…
          </div>
          <div className="grid cols-3 mt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card pad flex flex-col gap-2">
                <Skeleton h={26} w={64} /><Skeleton h={12} w="70%" />
              </div>
            ))}
          </div>
          {[0, 1].map((c) => (
            <div key={c} className="mt-6">
              <Skeleton h={22} w={120} className="mb-3" />
              <div className="card overflow-hidden">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="vendor-row">
                    <div className="flex items-center gap-3">
                      <Skeleton h={40} w={40} r={12} />
                      <div className="flex flex-col gap-2">
                        <Skeleton h={14} w={140} /><Skeleton h={10} w={100} />
                      </div>
                    </div>
                    <Skeleton h={20} w={90} r={999} />
                    <Skeleton h={16} w={54} r={5} />
                    <Skeleton h={6} w={54} r={3} />
                    <Skeleton h={30} w={72} r={10} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="grid cols-3 mt-6">
            {[["Vendors found", vendors.length], ["Selected to call", active], ["Segments spanned", segments]].map(([l, n]) => (
              <div key={l as string} className="card pad stat">
                <span className="n">{n as number}</span><span className="l">{l as string}</span>
              </div>
            ))}
          </div>

          {Object.entries(byCat).map(([cat, vs]) => (
            <div key={cat} className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="capitalize m-0">{cat}</h2>
                <span className="small">{vs.filter((v) => !v.excluded).length} of {vs.length} selected</span>
              </div>
              <div className="card overflow-hidden">
                {vs.map((v) => (
                  <div className="vendor-row" key={v.id} style={{ opacity: v.excluded ? 0.5 : 1 }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={v.name} />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{v.name}</div>
                        <div className="small">
                          <span style={{ color: "var(--warn)" }}>★</span> {v.rating} · {v.review_count} reviews · {v.distance_km} km
                        </div>
                      </div>
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
          ))}
        </>
      )}
    </div>
  );
}
