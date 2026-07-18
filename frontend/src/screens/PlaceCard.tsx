import { useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "../ui";

const CAT_EMOJI: Record<string, string> = {
  catering: "🍽️", venue: "🏛️", decor: "🎀", decorations: "🎀",
  photo: "📸", photography: "📸", music: "🎵", flowers: "💐", florals: "💐",
};

// A "place card" that drops down under a vendor row: photos, meta, and quick links
// to Google Maps, website and socials — real Google data when a key is set, otherwise
// the known market data plus web-search links.
export default function PlaceCard({ vendorId, category }: { vendorId: string; category?: string }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let ok = true;
    api.vendorDetails(vendorId).then((x) => ok && setD(x)).catch(() => ok && setErr(true));
    return () => { ok = false; };
  }, [vendorId]);

  if (err) return <div className="place-panel"><div className="place-body"><span className="small">Couldn't load details.</span></div></div>;
  if (!d) return <div className="place-panel place-loading"><Spinner size={20} /><span className="small">Loading place…</span></div>;

  const emoji = CAT_EMOJI[(category || d.category || "").toLowerCase()] || "🎉";
  const links = [
    d.website && { href: d.website, label: "Website", icon: "🌐" },
    { href: d.maps_url, label: "Maps", icon: "📍" },
    { href: d.google_url, label: "Google", icon: "🔎" },
    d.socials?.instagram && { href: d.socials.instagram, label: "Instagram", icon: "📷" },
    d.socials?.facebook && { href: d.socials.facebook, label: "Facebook", icon: "👍" },
    d.phone && { href: `tel:${d.phone}`, label: d.phone, icon: "📞" },
  ].filter(Boolean) as { href: string; label: string; icon: string }[];

  return (
    <div className="place-panel" onClick={(e) => e.stopPropagation()}>
      <div className="place-photos">
        {d.photos?.length
          ? d.photos.map((p: string, i: number) => <img key={i} src={p} alt="" loading="lazy" />)
          : <div className="place-photo-ph"><span>{emoji}</span></div>}
      </div>
      <div className="place-body">
        <div className="place-metarow">
          <span className="place-rating">★ {d.rating || "—"}</span>
          <span className="small">{d.review_count} reviews</span>
          <span className="place-dot">·</span><span>{d.price}</span>
          {!!d.distance_km && <><span className="place-dot">·</span><span className="small">{d.distance_km} km</span></>}
          <span className="seg-tag">{d.segment_display}</span>
          {d.style && <span className={`style-tag style-${d.style}`}>{d.style}</span>}
        </div>
        {d.summary && <p className="place-summary">{d.summary}</p>}
        {d.address && <div className="place-line">📍 {d.address}</div>}
        {d.opening_hours?.length > 0 && (
          <details className="place-hours">
            <summary>Opening hours</summary>
            {d.opening_hours.map((h: string, i: number) => <div key={i} className="small">{h}</div>)}
          </details>
        )}
        <div className="place-links">
          {links.map((l, i) => (
            <a key={i} className="place-link" href={l.href} target="_blank" rel="noopener noreferrer">
              <span aria-hidden>{l.icon}</span>{l.label}
            </a>
          ))}
        </div>
        <div className="small place-src">
          {d.live ? "● Live from Google Places" : "Simulated market · links search the web for this place"}
        </div>
      </div>
    </div>
  );
}
