import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Login() {
  const { login, register, user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) nav("/");

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
    <div className="auth-wrap">
      <div className="card pad auth-card">
        <div className="brand" style={{ marginBottom: 6 }}>
          <span className="dot" /> The Event Negotiator
        </div>
        <p className="sub" style={{ marginBottom: 20 }}>
          Voice agents that call, compare, and haggle for your event.
        </p>
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
          <button className="btn lg" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} disabled={busy}>
            {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="small" style={{ textAlign: "center", marginTop: 16 }}>
          {mode === "register" ? "Already have an account?" : "New here?"}{" "}
          <a style={{ color: "var(--brand)", cursor: "pointer", fontWeight: 600 }}
             onClick={() => setMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? "Sign in" : "Create one"}
          </a>
        </p>
      </div>
    </div>
  );
}
