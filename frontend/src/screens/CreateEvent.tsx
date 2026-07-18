import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { applyTheme, clearTheme } from "../palette";
import { useSpeechRecognition, useElevenLabsAgent } from "../speech";
import {
  detectColors, detectEventType, detectGuests, detectVibeWords, extractKeywords,
  buildThemeTokens, readableText, imageColors,
} from "../vibe";
import { COUNTRIES, countryByCode, citiesFor, detectCountry } from "../geo";

const TYPES = [
  { key: "wedding", emoji: "💍", blurb: "Venue, catering, florals & more", guests: 80, perGuest: 320 },
  { key: "birthday", emoji: "🎂", blurb: "Party space, food, cake, music", guests: 30, perGuest: 90 },
  { key: "baby_shower", emoji: "🍼", blurb: "Cozy venue, catering, décor", guests: 25, perGuest: 70 },
];
const STEPS = ["Event", "Vibe", "Details", "Budget"];
const GUEST_PRESETS = [25, 50, 100, 150, 200];
const EXAMPLES = [
  "A rustic garden wedding, sage green and blush, 120 guests",
  "Boho birthday, terracotta and gold, 40 people",
  "Elegant baby shower, dusty blue, 25 guests",
];
type Bubble = { id: string; kind: string; label: string; hex?: string };

export default function CreateEvent() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [type, setType] = useState("");
  const [country, setCountry] = useState(() => detectCountry());
  const [city, setCity] = useState("");
  const [cityFocus, setCityFocus] = useState(false);
  const [guests, setGuests] = useState(50);
  const [date, setDate] = useState("");
  const [budget, setBudget] = useState(15000);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [interim, setInterim] = useState("");
  const [agentLine, setAgentLine] = useState("");
  const [pinUrl, setPinUrl] = useState("");
  const [drag, setDrag] = useState(false);
  const [elReady, setElReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const bid = useRef(0);
  const imageFiles = useRef<Record<string, File>>({});
  const pinUrls = useRef<string[]>([]);
  const transcript = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const cur = countryByCode(country);
  const region_profile = cur.region_profile;

  useEffect(() => {
    // default date ~8 weeks out
    const d = new Date(); d.setDate(d.getDate() + 56);
    setDate(d.toISOString().slice(0, 10));
    clearTheme();
    api.intakeSignedUrl().then((r) => setElReady(!!r.configured)).catch(() => {});
    return () => clearTheme();
  }, []);
  useEffect(() => { const tk = buildThemeTokens(colors); if (tk) applyTheme(tk); else clearTheme(); }, [colors]);

  const go = (to: number) => { setDir(to > step ? 1 : -1); setStep(Math.max(0, Math.min(STEPS.length - 1, to))); setErr(""); };
  const back = () => (step === 0 ? nav("/") : go(step - 1));

  const chooseType = (t: (typeof TYPES)[number]) => {
    setType(t.key); setGuests(t.guests); setBudget(Math.round(t.guests * t.perGuest / 500) * 500);
    go(1);
  };

  // ── bubbles / voice ──
  const addBubble = (b: Omit<Bubble, "id">) =>
    setBubbles((cur) => (cur.some((x) => x.kind === b.kind && x.label === b.label) ? cur : [...cur, { ...b, id: `b${bid.current++}` }]));
  const removeBubble = (id: string) => setBubbles((cur) => cur.filter((b) => b.id !== id));
  const removeImage = (id: string) => { setImages((cur) => cur.filter((i) => i.id !== id)); delete imageFiles.current[id]; };
  const addColors = (hexes: string[]) => setColors((cur) => Array.from(new Set([...cur, ...hexes])).slice(0, 6));

  const ingest = (text: string) => {
    if (!text.trim()) return;
    transcript.current.push(text);
    const ev = detectEventType(text); if (ev && !type) setType(ev);
    const g = detectGuests(text); if (g) { setGuests(g); addBubble({ kind: "guests", label: `${g} guests` }); }
    const cols = detectColors(text);
    cols.forEach((c) => addBubble({ kind: "color", label: c.name, hex: c.hex }));
    if (cols.length) addColors(cols.map((c) => c.hex));
    (detectVibeWords(text).length ? detectVibeWords(text) : extractKeywords(text)).forEach((w) => addBubble({ kind: "keyword", label: w }));
  };
  const speech = useSpeechRecognition((f) => { ingest(f); setInterim(""); }, (i) => setInterim(i));
  const el = useElevenLabsAgent({ onUserText: ingest, onAgentText: setAgentLine });
  const listening = speech.listening || el.active;
  const toggleMic = async () => {
    setErr("");
    if (elReady) { if (el.active) return el.stop(); const r = await api.intakeSignedUrl(); r.configured ? el.start(r.signed_url) : (setElReady(false), speech.start()); return; }
    if (!speech.supported) { setErr("Voice needs Google Chrome — or just type the details ahead."); return; }
    speech.listening ? speech.stop() : speech.start();
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    Array.from(list).filter((f) => f.type.startsWith("image/")).forEach((f) => {
      const id = `i${bid.current++}`;
      const url = URL.createObjectURL(f);
      imageFiles.current[id] = f;
      setImages((cur) => [...cur, { id, url }]);
      const img = new Image();
      img.onload = () => { const c = imageColors(img, 3); if (c.length) addColors(c); };
      img.src = url;
    });
  };
  const addPin = () => {
    const u = pinUrl.trim(); if (!/^https?:\/\//.test(u)) { setErr("Paste a full https:// link"); return; }
    pinUrls.current.push(u); addBubble({ kind: "source", label: u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 26) });
    setPinUrl(""); setErr("");
  };

  const citySuggest = useMemo(() => {
    const all = citiesFor(country); const q = city.trim().toLowerCase();
    return (q ? all.filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q) : all).slice(0, 6);
  }, [country, city]);

  const create = async () => {
    if (!type) { go(0); setErr("Pick an event type first."); return; }
    setBusy(true); setErr("");
    try {
      const created = await api.createEvent(type, region_profile);
      const sid = created.spec_id; const base = created.payload;
      const tokens = buildThemeTokens(colors);
      await api.patchSpec(sid, {
        event: { ...base.event, type, date, guest_count: guests },
        location: { ...base.location, city: city || base.location.city, region_profile, country },
        budget: { ...base.budget, total_ceiling: budget, currency: cur.currency },
        style: tokens ? {
          ...(base.style || {}), source: "voice_intake",
          palette: bubbles.filter((b) => b.kind === "color").map((b) => ({ hex: b.hex, name: b.label })),
          theme_tokens: tokens,
        } : (base.style || {}),
        intake: {
          keywords: bubbles.filter((b) => b.kind === "keyword").map((b) => b.label),
          colors, guests, sources: pinUrls.current, transcript: transcript.current.join(" "),
        },
      });
      for (const f of Object.values(imageFiles.current)) { try { await api.uploadBoard(sid, f); } catch { /* keep going */ } }
      for (const u of pinUrls.current) { try { await api.inspirationLink(sid, u); } catch { /* keep going */ } }
      await api.confirmSpec(sid);
      nav(`/spec/${sid}/discovery`);
    } catch (e: any) { setErr(e.message || "Could not create the event"); setBusy(false); }
  };

  // keyboard flow: Enter advances (unless typing), Esc goes back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape") { e.preventDefault(); back(); return; }
      if (e.key === "Enter" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON") {
        if (step < STEPS.length - 1) { if (!(step === 0 && !type)) go(step + 1); }
        else if (!busy && type) create();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const money = (n: number) => `${cur.symbol}${Math.round(n).toLocaleString()}`;
  const perGuest = guests > 0 ? Math.round(budget / guests) : 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="wiz">
      <header className="wiz-header">
        <button className="wiz-icon" onClick={back} aria-label="Back">←</button>
        <div className="wiz-brand"><span className="dot" /> Create event</div>
        <div className="wiz-steps">
          {STEPS.map((s, i) => (
            <button key={s} className={`wiz-pip ${i === step ? "on" : ""} ${i < step ? "done" : ""}`}
                    onClick={() => i < step && go(i)} disabled={i > step}>
              <span>{i < step ? "✓" : i + 1}</span><em>{s}</em>
            </button>
          ))}
        </div>
        <button className="wiz-icon" onClick={() => nav("/")} aria-label="Close">✕</button>
      </header>
      <div className="wiz-progress"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

      <main className="wiz-body">
        <div key={step} className={`wiz-step ${dir > 0 ? "fwd" : "back"}`}>
          {step === 0 && (
            <>
              <h1 className="wiz-h">What are we planning?</h1>
              <p className="wiz-sub">Pick the celebration — it tailors the categories, levers and market.</p>
              <div className="type-grid">
                {TYPES.map((t) => (
                  <button key={t.key} className={`type-card ${type === t.key ? "selected" : ""}`} onClick={() => chooseType(t)}>
                    <div className="type-emoji">{t.emoji}</div>
                    <div className="type-name">{t.key.replace("_", " ")}</div>
                    <div className="small">{t.blurb}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="wiz-h">Tell me the vibe</h1>
              <p className="wiz-sub">Speak freely — colors, mood, guest count. Name a color and the room repaints;
                drop an image or paste a link and the palette follows.</p>
              <div className={`studio-stage studio-drop ${drag ? "drag" : ""}`}
                   onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                   onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
                {images.length > 0 && (
                  <div className="stage-collage" aria-hidden>
                    {images.slice(0, 9).map((im) => <img key={im.id} src={im.url} alt="" />)}
                  </div>
                )}
                <div className="stage-content">
                  <div className="flex flex-col items-center text-center gap-3">
                    <button className={`mic-btn ${listening ? "listening" : ""}`} onClick={toggleMic}>{listening ? "■" : "🎤"}</button>
                    <div className="transcript-live">
                      {agentLine ? `🤖 ${agentLine}` : interim || (listening ? "Listening…" : `Tap to talk · ${elReady ? "AI agent" : speech.supported ? "browser voice" : "type below"}`)}
                    </div>
                  </div>
                  <div className="bubble-grid mt-6" style={{ justifyContent: "center" }}>
                    {bubbles.length === 0 && images.length === 0 && <span className="small">Your vibe will take shape here…</span>}
                    {bubbles.map((b) => (
                      <span key={b.id} className={`bubble ${b.kind === "color" ? "color" : b.kind === "source" ? "source" : ""}`}
                            style={b.hex ? { background: b.hex, color: readableText(b.hex) } : undefined}>
                        {b.kind === "source" && <span aria-hidden>📌</span>}
                        {b.kind === "keyword" && <span style={{ opacity: 0.5 }}>#</span>}
                        {b.label}<span className="x" onClick={() => removeBubble(b.id)}>×</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {images.length > 0 && (
                <div className="masonry mt-4">
                  {images.map((im) => (
                    <div className="tile" key={im.id}>
                      <img src={im.url} alt="" />
                      <button className="tile-x" onClick={() => removeImage(im.id)} aria-label="Remove">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3 flex-wrap mt-4 items-center">
                <button className="btn ghost sm" onClick={() => fileInput.current?.click()}>🖼 Add images</button>
                <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
                <div className="flex gap-2 items-center flex-1" style={{ minWidth: 240 }}>
                  <input placeholder="Paste a Pinterest / image link" value={pinUrl}
                         onChange={(e) => setPinUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPin()} />
                  <button className="btn ghost sm" onClick={addPin}>Add</button>
                </div>
              </div>

              <div className="try-row mt-3">
                <span className="small">No mic? Try:</span>
                {EXAMPLES.map((x) => (
                  <button key={x} className="try-chip" onClick={() => ingest(x)}>{x}</button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="wiz-h">When &amp; where</h1>
              <p className="wiz-sub">The essentials that shape every quote.</p>
              <div className="field-grid">
                <div>
                  <label>Date</label>
                  <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label>Guests</label>
                  <div className="stepper-row">
                    <button className="btn ghost sm" onClick={() => setGuests((g) => Math.max(1, g - 5))}>–</button>
                    <input type="number" value={guests} min={1}
                           onChange={(e) => setGuests(Math.max(1, +e.target.value || 0))} style={{ textAlign: "center" }} />
                    <button className="btn ghost sm" onClick={() => setGuests((g) => g + 5)}>+</button>
                  </div>
                  <div className="preset-row">
                    {GUEST_PRESETS.map((n) => (
                      <button key={n} className={`preset ${guests === n ? "on" : ""}`} onClick={() => setGuests(n)}>{n}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label>Country <span className="small">· detected</span></label>
                  <div className="country-row">
                    {COUNTRIES.map((c) => (
                      <button key={c.code} className={`country-chip ${country === c.code ? "on" : ""}`}
                              onClick={() => { setCountry(c.code); setCity(""); }} title={c.name}>
                        <span style={{ fontSize: 18 }}>{c.flag}</span> {c.code}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ position: "relative" }}>
                  <label>City</label>
                  <input placeholder={`e.g. ${citiesFor(country)[0] || "your city"}`} value={city}
                         onChange={(e) => setCity(e.target.value)} onFocus={() => setCityFocus(true)}
                         onBlur={() => setTimeout(() => setCityFocus(false), 150)} />
                  {cityFocus && citySuggest.length > 0 && (
                    <div className="city-menu">
                      {citySuggest.map((c) => (
                        <div key={c} className="city-opt" onMouseDown={() => { setCity(c); setCityFocus(false); }}>{c}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="wiz-h">Set your budget</h1>
              <p className="wiz-sub">A ceiling for the whole event — the agents negotiate to stay under it.</p>
              <div className="budget-display">{money(budget)}</div>
              <div className="small" style={{ textAlign: "center", marginBottom: 18 }}>≈ {money(perGuest)} per guest · {guests} guests</div>
              <input type="range" className="range" min={1000} max={type === "wedding" ? 120000 : 40000} step={500}
                     value={budget} onChange={(e) => setBudget(+e.target.value)} />
              <div className="wiz-review">
                <div className="rev-row"><span>Event</span><b className="capitalize">{type.replace("_", " ") || "—"}</b></div>
                <div className="rev-row"><span>Date</span><b>{date || "—"}</b></div>
                <div className="rev-row"><span>Guests</span><b>{guests}</b></div>
                <div className="rev-row"><span>Location</span><b>{city ? `${city}, ` : ""}{cur.flag} {cur.code}</b></div>
                {colors.length > 0 && (
                  <div className="rev-row"><span>Palette</span>
                    <span className="flex gap-1">{colors.map((h) => <span key={h} className="swatch-dot" style={{ background: h }} />)}</span></div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="wiz-footer">
        {err && <div className="err" style={{ marginRight: "auto" }}>{err}</div>}
        <button className="btn ghost" onClick={back}>{step === 0 ? "Cancel" : "← Back"}</button>
        {step < STEPS.length - 1 ? (
          <button className="btn lg" onClick={() => go(step + 1)} disabled={step === 0 && !type}>Continue →</button>
        ) : (
          <button className="btn lg" onClick={create} disabled={busy || !type}>{busy ? "Creating…" : "Create event ✦"}</button>
        )}
      </footer>
    </div>
  );
}
