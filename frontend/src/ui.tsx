// Small shared UI primitives used across screens to keep the product coherent.
import { useNavigate } from "react-router-dom";

const STEPS = ["Event", "Vibe", "Confirm", "Discovery", "Live"];

// 1-based current step. When a specId is given, completed steps become clickable so you
// can jump back and change the plan (Event/Vibe → the editable spec, in edit mode).
export function Stepper({ step, specId, campaignId }: { step: number; specId?: string; campaignId?: string }) {
  const nav = useNavigate();
  const routeFor = (i: number): string | null => {
    if (!specId) return null;
    switch (i) {
      case 0: case 1: return `/spec/${specId}?edit=1`;
      case 2: return `/spec/${specId}/confirm`;
      case 3: return `/spec/${specId}/discovery`;
      case 4: return campaignId ? `/campaign/${campaignId}/live` : null;
      default: return null;
    }
  };
  return (
    <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        const route = done ? routeFor(i) : null;
        const clickable = !!route;
        return (
          <div key={label} className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => route && nav(route)}
              title={clickable ? `Go back to ${label}` : undefined}
              className={`flex items-center gap-2 rounded-full transition-all ${clickable ? "cursor-pointer hover:opacity-80" : "cursor-default"} ${done && !active ? "pr-2" : ""}`}
            >
              <span
                className={`grid place-items-center w-7 h-7 rounded-full text-[13px] font-bold transition-all ${done || active ? "text-white" : "text-muted"}`}
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
            </button>
            {n < STEPS.length && <span className="w-5 sm:w-8 h-px" style={{ background: done ? "var(--brand)" : "var(--line)" }} />}
          </div>
        );
      })}
    </div>
  );
}

// Handoff prompt — a compact bottom-center toast (replaces the old full-width bar).
export function PullMeToast({ vendor, detail, onResolve }: { vendor: string; detail?: string; onResolve: () => void }) {
  return (
    <div className="pull-toast" role="alert">
      <span className="pull-toast-dot" aria-hidden />
      <div className="pull-toast-body flex-1">
        <div className="pull-toast-title">Pull me in</div>
        <div className="small truncate">{vendor}{detail ? ` · ${detail}` : ""}</div>
      </div>
      <button className="btn sm" onClick={onResolve}>Approve →</button>
    </div>
  );
}

// Mid-call trade-off the agent surfaces so it can bargain on your behalf.
export function QuestionPrompt({ q, onAnswer }:
  { q: { vendor_name: string; question: string; options: { key: string; label: string }[] }; onAnswer: (key: string) => void }) {
  return (
    <div className="q-prompt" role="dialog" aria-live="polite">
      <div className="q-prompt-top">
        <span className="q-prompt-dot" aria-hidden>💬</span>
        <span className="small">The agent needs your call · <b>{q.vendor_name}</b></span>
      </div>
      <div className="q-prompt-q">{q.question}</div>
      <div className="q-prompt-actions">
        {q.options.map((o) => (
          <button key={o.key} className={`btn ${o.key === "accept" ? "" : "ghost"} sm`} onClick={() => onAnswer(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
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
