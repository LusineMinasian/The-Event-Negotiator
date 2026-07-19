import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Spinner } from "../ui";

type Field = {
  key: string; label: string; secret: boolean;
  saved: boolean; preview: string; env_fallback: boolean;
};

// group keys by provider for a tidy, scannable form
const GROUPS: { title: string; hint: string; match: (k: string) => boolean }[] = [
  { title: "ElevenLabs", hint: "Voice agents — the calling & intake brains.", match: (k) => k.startsWith("elevenlabs") },
  { title: "Twilio", hint: "Telephony that actually dials the vendors.", match: (k) => k.startsWith("twilio") },
  { title: "Google Places", hint: "Real vendor discovery (falls back to the seeded market).", match: (k) => k.startsWith("google") },
  { title: "Anthropic", hint: "Nicer document reading & counterparty dialogue.", match: (k) => k.startsWith("anthropic") },
];

// Self-contained "bring your own keys" panel: reads the masked status, lets the
// user paste/clear per-provider keys and flip call mode, saves to their account.
// Used both on the standalone Settings page and in the Overview right column.
export default function KeysPanel() {
  const [data, setData] = useState<{ fields: Field[]; call_mode: string; live_calls_available: boolean } | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});   // only edited fields
  const [mode, setMode] = useState<string>("simulation");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    setBusy(true);
    api.settingsKeys().then((d) => { setData(d); setMode(d.call_mode); }).catch(() => setData(null)).finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => Object.keys(vals).length > 0 || (data && mode !== data.call_mode), [vals, mode, data]);
  const setVal = (k: string, v: string) => { setSaved(false); setVals((s) => ({ ...s, [k]: v })); };
  const clearVal = (k: string) => { setSaved(false); setVals((s) => ({ ...s, [k]: "" })); };

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.saveSettingsKeys({ values: vals, call_mode: mode });
      setData(d); setMode(d.call_mode); setVals({}); setSaved(true);
    } finally { setSaving(false); }
  };

  const fields = data?.fields || [];

  return (
    <div className="keys-panel">
      <div className="keys-head">
        <div>
          <h3 style={{ margin: 0 }}>Bring your own keys</h3>
          <div className="small">Stored on your account · applied to your calls, discovery & reading.</div>
        </div>
        <button className="btn ghost sm" onClick={load} disabled={busy} aria-label="Reload">
          {busy ? <Spinner size={13} /> : "↻"}
        </button>
      </div>

      {data && (
        <div className={`keys-status ${data.live_calls_available ? "ok" : "sim"}`}>
          <span className="connector-dot" />
          <span className="flex-1">{data.live_calls_available ? "Live calling ready" : "Simulation mode"}</span>
          <div className="seg-toggle" role="group" aria-label="Call mode">
            {["simulation", "live"].map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setSaved(false); }}
                      disabled={m === "live" && !data.live_calls_available}
                      title={m === "live" && !data.live_calls_available ? "Add ElevenLabs + Twilio keys first" : ""}>
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
