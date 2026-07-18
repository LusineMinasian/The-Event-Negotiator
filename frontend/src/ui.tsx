// Small shared UI primitives used across screens to keep the product coherent.

const STEPS = ["Event", "Vibe", "Confirm", "Discovery", "Live"];

// 1-based current step. Renders numbered circles with connectors; labels collapse on mobile.
export function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div key={label} className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-2">
              <span
                className={`grid place-items-center w-7 h-7 rounded-full text-[13px] font-bold transition-all ${
                  done ? "text-white" : active ? "text-white" : "text-muted"
                }`}
                style={
                  done || active
                    ? { background: "linear-gradient(135deg, var(--brand), var(--brand-2))", boxShadow: "0 3px 10px rgba(79,70,229,0.30)" }
                    : { background: "#eef1f8" }
                }
              >
                {done ? "✓" : n}
              </span>
              <span className={`text-[13px] font-semibold ${active ? "text-ink" : "text-muted"} ${active ? "" : "hidden sm:inline"}`}>
                {label}
              </span>
            </div>
            {n < STEPS.length && <span className="w-5 sm:w-8 h-px" style={{ background: done ? "var(--brand)" : "var(--line)" }} />}
          </div>
        );
      })}
    </div>
  );
}

export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-wrap" role="status" aria-live="polite">
      <Spinner size={30} />
      <span className="small">{label}</span>
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", r = 8, className = "" }:
  { h?: number | string; w?: number | string; r?: number; className?: string }) {
  return <div className={`skel ${className}`} style={{ height: h, width: w, borderRadius: r }} />;
}

const AVATAR_BG = ["#4f46e5", "#7c3aed", "#0891b2", "#059669", "#d97706", "#db2777", "#2563eb"];

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = (name.match(/[a-z0-9]+/gi) || []).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = AVATAR_BG[h % AVATAR_BG.length];
  return (
    <span
      className="grid place-items-center rounded-xl text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${bg}, color-mix(in srgb, ${bg} 65%, #000 12%))` }}
    >
      {initials}
    </span>
  );
}
