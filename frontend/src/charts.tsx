// Dependency-free SVG/HTML chart primitives, themed with the app's CSS variables.
// Kept tiny on purpose: an area curve, a donut, and horizontal bars cover the
// whole live dashboard without pulling in a charting library.

export function AreaChart({ points, height = 130, stroke = "var(--brand)" }:
  { points: number[]; height?: number; stroke?: string }) {
  const W = 100;
  const H = height;
  const pad = 6;
  if (points.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
           style={{ display: "block" }}>
        <line x1="0" y1={H - pad} x2={W} y2={H - pad} stroke="var(--line)" strokeWidth="1"
              vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const max = Math.max(...points, 1);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const gid = `g-${stroke.replace(/[^a-z]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
         style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type Seg = { label: string; value: number; color: string };

export function Donut({ segments, size = 148, thickness = 18, centerLabel, centerSub }:
  { segments: Seg[]; size?: number; thickness?: number; centerLabel?: string; centerSub?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {segments.filter((s) => s.value > 0).map((s, i) => {
          const len = (s.value / total) * circ;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                    strokeWidth={thickness} strokeDasharray={`${len} ${circ - len}`}
                    strokeDashoffset={-offset} strokeLinecap="butt"
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    style={{ transition: "stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease" }} />
          );
          offset += len;
          return el;
        })}
      </svg>
      {centerLabel != null && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>{centerLabel}</div>
            {centerSub && <div className="small">{centerSub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

type BarRow = { label: string; value: number; caption?: string; color?: string };

export function Bars({ rows, format }: { rows: BarRow[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bars">
      {rows.length === 0 && <div className="small">No data yet…</div>}
      {rows.map((r, i) => (
        <div key={i} className="bar-row">
          <div className="bar-label">
            <span>{r.label}</span>
            {r.caption && <span className="small">{r.caption}</span>}
          </div>
          <div className="bar-track">
            <span style={{ width: `${(r.value / max) * 100}%`, background: r.color || "var(--brand)" }} />
          </div>
          <span className="mono bar-val">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
