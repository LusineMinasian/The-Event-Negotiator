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
      {/* brand / marketing panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 text-white overflow-hidden"
           style={{ background: "linear-gradient(150deg, #4338ca 0%, #4f46e5 45%, #7c3aed 100%)" }}>
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-30 blur-3xl"
             style={{ background: "radial-gradient(circle, #a78bfa, transparent 70%)" }} />
        <div className="relative flex items-center gap-3 font-bold text-lg">
          <span className="w-8 h-8 rounded-[10px] bg-white/20 backdrop-blur grid place-items-center">◆</span>
          The Event Negotiator
        </div>
        <div className="relative">
          <h1 className="text-white text-[38px] leading-tight font-extrabold tracking-tight max-w-md">
            Your voice agents call the market and haggle for your event.
          </h1>
          <div className="mt-9 grid gap-5 max-w-md">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4 items-start">
                <span className="text-2xl w-11 h-11 shrink-0 rounded-xl bg-white/15 backdrop-blur grid place-items-center">{f.icon}</span>
                <div>
                  <div className="font-semibold">{f.title}</div>
                  <div className="text-white/75 text-sm leading-relaxed">{f.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-white/70 text-sm">
          Runs fully in simulation — no keys needed to see it work end to end.
        </div>
      </div>

      {/* form panel */}
      <div className="flex items-center justify-center p-6 bg-[#eef1f8]">
        <div className="card pad auth-card">
          <div className="brand lg:hidden mb-1"><span className="dot" /> The Event Negotiator</div>
          <h2 className="text-[22px] mb-1">{mode === "register" ? "Create your account" : "Welcome back"}</h2>
          <p className="sub mb-5">{mode === "register" ? "Create your first event in under a minute." : "Sign in to pick up where you left off."}</p>

          <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-xl bg-[#eef1f8] border border-line">
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
