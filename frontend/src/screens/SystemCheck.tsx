import { useEffect, useState } from "react";
import { api } from "../api";
import { clearTheme } from "../palette";
import { Spinner } from "../ui";

// Whether the browser can do on-device speech capture (Chrome routes this through
// Google's recognizer — the "Google Chrome" voice connector).
function browserSpeech() {
  const w = window as any;
  return {
    supported: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
    secure: window.isSecureContext,
  };
}

const PILL: Record<string, { cls: string; label: string }> = {
  ok: { cls: "live", label: "● connected" },
  fail: { cls: "sim", label: "● error" },
  not_configured: { cls: "", label: "○ not configured" },
};

export default function SystemCheck() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const speech = browserSpeech();

  const run = () => {
    setBusy(true);
    api.preflight().then(setData).catch(() => setData(null)).finally(() => setBusy(false));
  };
  useEffect(() => { clearTheme(); run(); }, []);

  const checks = data?.checks || [];
  const speechCheck = {
    id: "browser_speech",
    name: "Browser voice (Google Chrome)",
    status: speech.supported && speech.secure ? "ok" : "not_configured",
    detail: speech.supported
      ? (speech.secure ? "Web Speech API available — voice intake works here" : "Needs a secure (https/localhost) context")
      : "Open in Google Chrome for on-device speech recognition",
    fix: "Use Google Chrome; other browsers may lack the Web Speech API.",
  };
  const allChecks = [speechCheck, ...checks];

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <div className="section-eyebrow">Connectors</div>
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1>System check</h1>
          <p className="sub mb-0">A real preflight — each connector is actually probed. Add credentials in <span className="mono">.env</span> and re-run to watch them turn green.</p>
        </div>
        <button className="btn ghost sm" onClick={run} disabled={busy}>
          {busy ? <Spinner size={14} /> : "↻"} Re-run
        </button>
      </div>

      {data && (
        <div className={`connector mt-5 ${data.can_place_live_calls ? "ok" : "sim"}`}>
          <div className="connector-dot" />
          <div className="flex-1">
            <div className="font-bold">{data.summary}</div>
            <div className="small">Call mode: <b className="capitalize">{data.call_mode}</b></div>
          </div>
          <span className={`chip ${data.can_place_live_calls ? "live" : "sim"}`}>
            {data.can_place_live_calls ? "● live-ready" : "● simulation"}
          </span>
        </div>
      )}

      <div className="grid gap-3 mt-4">
        {busy && !data && <div className="loading-wrap" style={{ minHeight: 180 }}><Spinner size={28} /><span className="small">Probing connectors…</span></div>}
        {allChecks.map((ck: any) => {
          const p = PILL[ck.status] || PILL.not_configured;
          return (
            <div key={ck.id} className="card pad flex items-start gap-4">
              <span className={`check-dot ${ck.status}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="font-semibold">{ck.name}</div>
                  <span className={`chip ${p.cls}`}>{p.label}</span>
                </div>
                {ck.detail && <div className="small mt-1">{ck.detail}</div>}
                {ck.status !== "ok" && ck.fix && (
                  <div className="small mt-2 flex items-start gap-2" style={{ color: "var(--ink-2)" }}>
                    <span aria-hidden>🔧</span><span>{ck.fix}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="banner mt-5">
        Real outbound calls need <b>CALL_MODE=live</b> plus a working ElevenLabs agent with a linked phone
        number (which drives Twilio). Until then every call runs on the deterministic simulation — the demo
        works with zero keys.
      </div>
    </div>
  );
}
