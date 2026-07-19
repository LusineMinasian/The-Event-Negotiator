import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Spinner } from "../ui";

type Field = {
  key: string; label: string; secret: boolean;
  saved: boolean; preview: string; env_fallback: boolean;
};

// group keys by provider for a tidy, scannable form
const GROUPS: { title: string; hint: string; match: (k: string) => boolean }[] = [
  { title: "ElevenLabs", hint: "Voice agents — the calling & intake brains.", match: (k) => k.startsWith("elevenlabs") },
  { title: "Demo call", hint: "In Live mode the agent rings only this one number — you play a vendor — while every other call stays simulated.", match: (k) => k.startsWith("simulation") },
  { title: "Twilio", hint: "Telephony to dial real vendors (not needed for the demo call).", match: (k) => k.startsWith("twilio") },
  { title: "Google Places", hint: "Real vendor discovery (falls back to the seeded market).", match: (k) => k.startsWith("google") },
  { title: "Anthropic", hint: "Nicer document reading & counterparty dialogue.", match: (k) => k.startsWith("anthropic") },
];

// Parse a .env or CSV file into { ENV_NAME: value }. Handles `export K=V`,
// `K=V`, `K,V`, quotes and comments.
function parseKeyFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.split(/\r?\n/).forEach((raw) => {
    let s = raw.trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) return;
    s = s.replace(/^export\s+/i, "");
    const m = s.match(/^([A-Za-z0-9_.\- ]+?)\s*[=,;\t]\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1].trim().toUpperCase().replace(/[.\- ]/g, "_")] = v;
  });
  return out;
}

// Self-contained "bring your own keys" panel: reads the masked status, lets the
// user paste/clear per-provider keys and flip call mode, saves to their account.
// Used both on the standalone Settings page and in the Overview right column.
export default function KeysPanel() {
  const [data, setData] = useState<{ fields: Field[]; call_mode: string; live_calls_available: boolean; demo_call_available?: boolean } | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});   // only edited fields
  const [mode, setMode] = useState<string>("simulation");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setBusy(true);
    api.settingsKeys().then((d) => { setData(d); setMode(d.call_mode); }).catch(() => setData(null)).finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => Object.keys(vals).length > 0 || (data && mode !== data.call_mode), [vals, mode, data]);
  const setVal = (k: string, v: string) => { setSaved(false); setImportMsg(""); setVals((s) => ({ ...s, [k]: v })); };
  const clearVal = (k: string) => { setSaved(false); setImportMsg(""); setVals((s) => ({ ...s, [k]: "" })); };

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.saveSettingsKeys({ values: vals, call_mode: mode });
      setData(d); setMode(d.call_mode); setVals({}); setSaved(true); setImportMsg("");
      // let the top-bar chip reflect the new call mode instantly
      window.dispatchEvent(new CustomEvent("en:call-mode", {
        detail: { call_mode: d.call_mode, live: !!(d.live_calls_available || d.demo_call_available) },
      }));
    } finally { setSaving(false); }
  };

  // Export a CSV of the current keys (KEY,VALUE + CALL_MODE). Secret values are
  // never stored in the clear, so they export blank unless just typed here.
  const exportCsv = () => {
    const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows: string[][] = [["KEY", "VALUE"]];
    (data?.fields || []).forEach((f) => {
      const v = f.key in vals ? vals[f.key] : (f.secret ? "" : f.preview);
      rows.push([f.key.toUpperCase(), v || ""]);
    });
    rows.push(["CALL_MODE", mode]);
    const csv = rows.map((r) => r.map(cell).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "event-negotiator-keys.csv"; a.click();
    URL.revokeObjectURL(url);
    setImportMsg("Exported CSV — secret keys are blank (never stored in the clear).");
  };

  // Import a .env / CSV: match ENV names to our fields and stage the values for review.
  const onImport = async (file: File) => {
    const parsed = parseKeyFile(await file.text());
    const next: Record<string, string> = {};
    (data?.fields || []).forEach((f) => {
      const v = parsed[f.key.toUpperCase()];
      if (v != null && v !== "") next[f.key] = v;
    });
    const n = Object.keys(next).length;
    if (n === 0) { setImportMsg("No matching keys found in that file."); return; }
    setSaved(false);
    setVals((s) => ({ ...s, ...next }));
    setImportMsg(`Imported ${n} key${n > 1 ? "s" : ""} — review and Save.`);
  };

  const testCall = async () => {
    setTesting(true); setTestRes(null);
    try {
      setTestRes(await api.testCall());
    } catch (e: any) {
      setTestRes({ ok: false, error: e?.message || "request failed" });
    } finally { setTesting(false); }
  };

  const fields = data?.fields || [];
  const canLive = !!(data?.live_calls_available || data?.demo_call_available);

  return (
    <div className="keys-panel">
      <div className="keys-head">
        <div>
          <h3 style={{ margin: 0 }}>Bring your own keys</h3>
          <div className="small">Stored on your account · applied to your calls, discovery & reading.</div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".env,.csv,.txt,text/plain" style={{ display: "none" }}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
          <button className="btn ghost sm" onClick={() => fileRef.current?.click()} title="Import a .env or CSV file">⤵ Import</button>
          <button className="btn ghost sm" onClick={exportCsv} disabled={busy} title="Download keys as CSV">⤴ Export</button>
          <button className="btn ghost sm" onClick={load} disabled={busy} aria-label="Reload">
            {busy ? <Spinner size={13} /> : "↻"}
          </button>
        </div>
      </div>

      {importMsg && <div className="small keys-import-msg">{importMsg}</div>}

      {data && (
        <div className={`keys-status ${canLive ? "ok" : "sim"}`}>
          <span className="connector-dot" />
          <span className="flex-1">
            {data.demo_call_available && !data.live_calls_available ? "Demo call ready (one number)"
              : canLive ? "Live calling ready" : "Simulation mode"}
          </span>
          <div className="seg-toggle" role="group" aria-label="Call mode">
            {["simulation", "live"].map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setSaved(false); }}
                      disabled={m === "live" && !canLive}
                      title={m === "live" && !canLive ? "Add ElevenLabs keys + your phone number (or full Twilio) first" : ""}>
                {m === "simulation" ? "Sim" : "Live"}
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && !data && <div className="loading-wrap" style={{ minHeight: 120 }}><Spinner size={24} /></div>}

      {GROUPS.map((g) => {
        const gf = fields.filter((f) => g.match(f.key));
        if (gf.length === 0) return null;
        return (
          <div key={g.title} className="keys-group">
            <div className="keys-group-title">{g.title}</div>
            {gf.map((f) => {
              const edited = f.key in vals;
              const placeholder = f.saved ? (f.secret ? `saved · ${f.preview}` : f.preview)
                : f.env_fallback ? "using server default" : "not set";
              return (
                <div className="field-row" key={f.key}>
                  <label htmlFor={`k-${f.key}`}>{f.label}</label>
                  <div className="field-input">
                    <input id={`k-${f.key}`} type={f.secret ? "password" : "text"} autoComplete="off"
                           spellCheck={false} placeholder={placeholder}
                           value={edited ? vals[f.key] : ""}
                           onChange={(e) => setVal(f.key, e.target.value)} />
                    {(f.saved || edited) && (
                      <button className="btn ghost sm" type="button" onClick={() => clearVal(f.key)} title="Clear this key">✕</button>
                    )}
                  </div>
                  {edited && vals[f.key] === "" && f.saved && <div className="small warn-text">Will be removed on save</div>}
                </div>
              );
            })}
          </div>
        );
      })}

      {data?.demo_call_available && (
        <div className="test-call">
          <button className="btn ghost sm" onClick={testCall} disabled={testing}>
            {testing ? <Spinner size={13} /> : "📞"} Test call to my phone
          </button>
          {testRes && <TestResult res={testRes} />}
        </div>
      )}

      <div className="save-bar">
        {saved && <span className="small" style={{ color: "var(--good)" }}>✓ Active now</span>}
        <span className="spacer" />
        <button className="btn sm" onClick={save} disabled={!dirty || saving}>
          {saving ? <Spinner size={13} /> : null} Save keys
        </button>
      </div>
    </div>
  );
}

// Renders the outcome of a test call: on success, the call IDs to trace + direct
// links to the ElevenLabs and Twilio logs where a downstream failure actually shows.
function TestResult({ res }: { res: any }) {
  if (!res.ok) {
    return (
      <div className="test-out bad">
        <div className="mono" style={{ wordBreak: "break-word" }}>✕ {res.error || `HTTP ${res.status || "error"}`}</div>
      </div>
    );
  }
  const resp = res.response || {};
  const cid = resp.conversation_id || resp.conversationId || "";
  const sid = resp.callSid || resp.call_sid || resp.sid || resp.twilio_call_sid || "";
  return (
    <div className="test-out good">
      <div><b>✓ ElevenLabs accepted the call{res.to ? ` to ${res.to}` : ""}</b> — your phone should ring shortly.</div>
      {(cid || sid) && (
        <div className="small mono" style={{ marginTop: 6, wordBreak: "break-word" }}>
          {cid && <>conversation: {cid}<br /></>}
          {sid && <>Twilio call SID: {sid}</>}
        </div>
      )}
      <div className="small" style={{ marginTop: 8 }}>
        Didn't ring? The real ring/failure happens downstream — trace this call in the logs:
        <ul className="test-links">
          <li><a href="https://elevenlabs.io/app/conversational-ai/history" target="_blank" rel="noreferrer">ElevenLabs → Conversation history ↗</a></li>
          <li><a href="https://console.twilio.com/us1/monitor/logs/calls" target="_blank" rel="noreferrer">Twilio → Monitor → Call logs ↗</a></li>
          <li><a href="https://console.twilio.com/us1/monitor/logs/debugger" target="_blank" rel="noreferrer">Twilio → Debugger (error codes) ↗</a></li>
        </ul>
        Most common causes: Twilio <b>Geo-Permissions</b> block your country (enable it in Voice → Settings → Geo permissions),
        a <b>trial</b> Twilio account can only call verified numbers, or the ElevenLabs phone number isn't a live Twilio number.
      </div>
    </div>
  );
}
