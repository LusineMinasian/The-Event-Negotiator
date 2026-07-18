import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

const FEATURES = [
  { icon: "📞", title: "A fleet that calls for you", body: "Voice agents phone the whole vendor market in parallel." },
  { icon: "🤝", title: "Negotiates with real leverage", body: "Competing bids, weekday slots and bundles — used only when verified." },
  { icon: "🧾", title: "Hands you a ranked receipt", body: "Evidence-backed quotes, red flags surfaced, best pick per category." },
];

export default function Login() {
  const { login, register, user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) nav("/"); }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "register") await register(email, password, name);
      else await login(email, password);
      nav("/");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* brand / marketing panel — soft pastel hero */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden"
           style={{ background: "radial-gradient(70% 60% at 12% 0%, rgba(167,139,250,0.55), transparent 60%), radial-gradient(58% 55% at 96% 18%, rgba(244,160,200,0.5), transparent 60%), radial-gradient(64% 60% at 60% 104%, rgba(255,206,150,0.45), transparent 60%), #f6f1fb" }}>
        <div className="relative flex items-center gap-3 font-bold text-lg" style={{ color: "var(--ink)" }}>
          <span className="w-9 h-9 rounded-[11px] grid place-items-center" style={{ background: "linear-gradient(150deg,#322a42,#201a2b)", color: "#d9c8ff" }}>✦</span>
          The Event Negotiator
        </div>
        <div className="relative">
          <span className="section-eyebrow" style={{ background: "rgba(255,255,255,0.7)" }}>Voice negotiation</span>
          <h1 className="text-[40px] leading-[1.05] font-extrabold tracking-tight max-w-md" style={{ color: "var(--ink)" }}>
            Your voice agents call the market and haggle for your event.
          </h1>
          <div className="mt-8 grid gap-3 max-w-md">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4 items-start rounded-2xl p-3"
                   style={{ background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.75)" }}>
                <span className="text-2xl w-11 h-11 shrink-0 rounded-xl grid place-items-center"
                      style={{ background: "#fff", boxShadow: "var(--shadow)" }}>{f.icon}</span>
                <div>
                  <div className="font-semibold" style={{ color: "var(--ink)" }}>{f.title}</div>
                  <div className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{f.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-sm" style={{ color: "var(--ink-2)" }}>
          Runs fully in simulation — no keys needed to see it work end to end.
        </div>
      </div>

      {/* form panel */}
      <div className="flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="card pad auth-card">
          <div className="brand lg:hidden mb-1"><span className="dot" /> The Event Negotiator</div>
          <h2 className="text-[22px] mb-1">{mode === "register" ? "Create your account" : "Welcome back"}</h2>
          <p className="sub mb-5">{mode === "register" ? "Create your first event in under a minute." : "Sign in to pick up where you left off."}</p>

          <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-xl bg-[#f2ecfb] border border-line">
            {(["register", "login"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setErr(""); }}
                className={`py-2 rounded-lg text-sm font-semibold transition-all ${mode === m ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                {m === "register" ? "Sign up" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            {mode === "register" && (
              <div className="field">
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie" />
              </div>
            )}
            <div className="field">
              <label>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {err && <div className="err">{err}</div>}
            <button className="btn lg w-full mt-2" disabled={busy}>
              {busy ? "One moment…" : mode === "register" ? "Create account" : "Sign in"}
            </button>
          </form>
          <p className="small text-center mt-4">
            {mode === "register" ? "Already have an account?" : "New here?"}{" "}
            <a className="font-semibold cursor-pointer" style={{ color: "var(--brand)" }}
               onClick={() => setMode(mode === "register" ? "login" : "register")}>
              {mode === "register" ? "Sign in" : "Create one"}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
