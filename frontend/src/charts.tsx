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

// A small candlestick strip — a nod to a trading terminal. Each candle is one
// price move: body from the previous saving to this one, green when this call
// saved more than the last, red when less. Honest data, market-chart styling.
export function Candles({ series, height = 92, count = 22 }:
  { series: number[]; height?: number; count?: number }) {
  const W = 100, H = height, pad = 8;
  const s = series.slice(-(count + 1));
  if (s.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const candles = s.slice(1).map((v, i) => {
    const open = s[i], close = v;
    return { open, close, hi: Math.max(open, close), lo: Math.min(open, close), up: close >= open };
  });
  const max = Math.max(...s), min = Math.min(...s), span = max - min || 1;
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const cw = W / candles.length;
  const bw = Math.min(cw * 0.6, 5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      {candles.map((c, i) => {
        const cx = (i + 0.5) * cw;
        const col = c.up ? "var(--good)" : "var(--bad)";
        const top = Math.min(y(c.open), y(c.close));
        const h = Math.max(Math.abs(y(c.close) - y(c.open)), 1.5);
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={y(c.hi)} y2={y(c.lo)} stroke={col} strokeWidth="1"
                  vectorEffect="non-scaling-stroke" opacity="0.7" />
            <rect x={cx - bw / 2} y={top} width={bw} height={h} fill={col} rx="0.8" />
          </g>
        );
      })}
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
