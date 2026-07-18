import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { applyTheme, clearTheme } from "../palette";
import { Stepper } from "../ui";
import { useSpeechRecognition, useElevenLabsAgent } from "../speech";
import {
  detectColors, detectEventType, detectGuests, detectVibeWords, extractKeywords,
  buildThemeTokens, readableText, imageColors,
} from "../vibe";

const EMOJI: Record<string, string> = { wedding: "💍", birthday: "🎂", baby_shower: "🍼" };

type Bubble = { id: string; kind: string; label: string; hex?: string; img?: string };

export default function Onboarding() {
  const nav = useNavigate();
  const [events, setEvents] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [type, setType] = useState("");
  const [region, setRegion] = useState("us_ca");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [guests, setGuests] = useState<number | null>(null);
  const [interim, setInterim] = useState("");
  const [agentLine, setAgentLine] = useState("");
  const [pinUrl, setPinUrl] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [elReady, setElReady] = useState(false);

  const bid = useRef(0);
  const files = useRef<File[]>([]);
  const pinUrls = useRef<string[]>([]);
  const transcript = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    clearTheme();
    api.meta().then((m) => { setEvents(m.events); setRegions(m.regions); });
    api.intakeSignedUrl().then((r) => setElReady(!!r.configured)).catch(() => {});
  }, []);

  // recolor the whole stage whenever the palette grows
  useEffect(() => {
    const tk = buildThemeTokens(colors);
    if (tk) applyTheme(tk); else clearTheme();
  }, [colors]);

  const addBubble = (b: Omit<Bubble, "id">) =>
    setBubbles((cur) => (cur.some((x) => x.kind === b.kind && x.label === b.label) ? cur
      : [...cur, { ...b, id: `b${bid.current++}` }]));
  const removeBubble = (id: string) => setBubbles((cur) => cur.filter((b) => b.id !== id));
  const addColors = (hexes: string[]) =>
    setColors((cur) => Array.from(new Set([...cur, ...hexes])).slice(0, 6));

  // core: turn any recognized speech into bubbles + fields + palette
  const ingest = (text: string) => {
    if (!text.trim()) return;
    transcript.current.push(text);
    const ev = detectEventType(text);
    if (ev) { setType(ev); addBubble({ kind: "event", label: ev.replace("_", " ") }); }
    const g = detectGuests(text);
    if (g) { setGuests(g); addBubble({ kind: "guests", label: `${g} guests` }); }
    const cols = detectColors(text);
    cols.forEach((c) => addBubble({ kind: "color", label: c.name, hex: c.hex }));
    if (cols.length) addColors(cols.map((c) => c.hex));
    const vibes = detectVibeWords(text);
    (vibes.length ? vibes : extractKeywords(text)).forEach((w) => addBubble({ kind: "keyword", label: w }));
  };

  const speech = useSpeechRecognition(
    (final) => { ingest(final); setInterim(""); },
    (i) => setInterim(i),
  );
  const el = useElevenLabsAgent({
    onUserText: (t) => ingest(t),
    onAgentText: (t) => setAgentLine(t),
  });
  const listening = speech.listening || el.active;

  const toggleMic = async () => {
    setErr("");
    if (elReady) {
      if (el.active) { el.stop(); return; }
      const r = await api.intakeSignedUrl();
      if (r.configured) el.start(r.signed_url);
      else { setElReady(false); speech.start(); }
      return;
    }
    if (!speech.supported) { setErr("Voice needs Google Chrome (Web Speech API). You can still type & tap below."); return; }
    speech.listening ? speech.stop() : speech.start();
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    Array.from(list).filter((f) => f.type.startsWith("image/")).forEach((f) => {
      files.current.push(f);
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const cols = imageColors(img, 3);
        addBubble({ kind: "image", label: f.name, img: url });
        if (cols.length) addColors(cols);
      };
      img.src = url;
    });
  };

  const addPin = () => {
    const u = pinUrl.trim();
    if (!/^https?:\/\//.test(u)) { setErr("Paste a full https:// board or image link"); return; }
    pinUrls.current.push(u);
    const label = u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 28);
    addBubble({ kind: "source", label });
    setPinUrl(""); setErr("");
  };

  const createPipeline = async () => {
    if (!type) { setErr("Pick or say an event type to build the pipeline."); return; }
    setBusy(true); setErr("");
    try {
      const created = await api.createEvent(type, region);
      const sid = created.spec_id;
      const base = created.payload;
      const colorBubbles = bubbles.filter((b) => b.kind === "color");
      const tokens = buildThemeTokens(colors);
      await api.patchSpec(sid, {
        event: { ...base.event, guest_count: guests ?? base.event.guest_count },
        location: base.location,
        // carry the voice-captured palette through so the room stays painted
        style: tokens ? {
          ...(base.style || {}), source: "voice_intake",
          palette: colorBubbles.map((b) => ({ hex: b.hex, name: b.label })),
          theme_tokens: tokens,
        } : (base.style || {}),
        intake: {
          keywords: bubbles.filter((b) => b.kind === "keyword").map((b) => b.label),
          colors, guests,
          sources: pinUrls.current,
          transcript: transcript.current.join(" "),
        },
      });
      for (const f of files.current) { try { await api.uploadBoard(sid, f); } catch { /* keep going */ } }
      for (const u of pinUrls.current) { try { await api.inspirationLink(sid, u); } catch { /* keep going */ } }
      nav(`/spec/${sid}`);
    } catch (e: any) {
      setErr(e.message || "Could not create the pipeline");
      setBusy(false);
    }
  };

  const voiceLabel = elReady ? "AI intake agent (ElevenLabs)" : speech.supported ? "Browser voice (Chrome)" : "Voice unavailable";

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <Stepper step={1} />
      <div className="section-eyebrow">New negotiation</div>
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1>Talk us through your event</h1>
          <p className="sub mb-0">Tap the mic and describe it. Colors, guest count and vibe appear as bubbles —
            mention a color and it paints the room; drop images or a Pinterest link and the palette follows.</p>
        </div>
        <span className={`chip ${el.active || speech.listening ? "live" : "sim"}`}>{voiceLabel}</span>
      </div>

      <div className={`studio-stage studio-drop mt-5 ${drag ? "drag" : ""}`}
           onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
           onDragLeave={() => setDrag(false)}
           onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
        <div className="flex flex-col items-center text-center gap-3">
          <button className={`mic-btn ${listening ? "listening" : ""}`} onClick={toggleMic}
                  aria-label={listening ? "Stop" : "Start talking"}>
            {listening ? "■" : "🎤"}
          </button>
          <div className="transcript-live">
            {agentLine ? `🤖 ${agentLine}` : interim ? interim : listening ? "Listening… tell me about your event" : "Tap to talk — or drop inspiration below"}
          </div>
        </div>

        <div className="bubble-grid mt-6" style={{ justifyContent: "center" }}>
          {bubbles.length === 0 && <span className="small">Your event will take shape here as you speak…</span>}
          {bubbles.map((b) => (
            <span key={b.id}
                  className={`bubble ${b.kind === "color" ? "color" : b.kind === "image" ? "image" : b.kind === "source" ? "source" : ""}`}
                  style={b.hex ? { background: b.hex, color: readableText(b.hex) } : undefined}>
              {b.kind === "image" && b.img && <img src={b.img} alt="" />}
              {b.kind === "color" && <span className="swatch-dot" style={{ background: "rgba(255,255,255,0.6)" }} />}
              {b.kind === "source" && <span aria-hidden>📌</span>}
              {b.kind === "keyword" && <span style={{ opacity: 0.5 }}>#</span>}
              {b.label}
              <span className="x" onClick={() => removeBubble(b.id)}>×</span>
            </span>
          ))}
        </div>
      </div>

      {/* inspiration inputs */}
      <div className="flex gap-3 flex-wrap mt-4 items-center">
        <button className="btn ghost sm" onClick={() => fileInput.current?.click()}>🖼 Add images</button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden
               onChange={(e) => onFiles(e.target.files)} />
        <div className="flex gap-2 items-center flex-1" style={{ minWidth: 260 }}>
          <input placeholder="Paste a Pinterest board / image link" value={pinUrl}
                 onChange={(e) => setPinUrl(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && addPin()} />
          <button className="btn ghost sm" onClick={addPin}>Add</button>
        </div>
      </div>

      {/* event type + region + go */}
      <div className="card pad mt-5">
        <label>Event type {type ? "" : "(pick or say it)"}</label>
        <div className="flex gap-3 flex-wrap mt-1">
          {events.map((e) => (
            <button key={e.key} className={`event-card ${type === e.key ? "selected" : ""}`}
                    style={{ padding: 14, flex: "0 0 auto", display: "flex", alignItems: "center", gap: 10 }}
                    onClick={() => setType(e.key)}>
              <span style={{ fontSize: 24 }}>{EMOJI[e.key] || "🎉"}</span>
              <span className="font-semibold">{e.display_name}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-4 flex-wrap items-end mt-4">
          <div style={{ maxWidth: 220 }}>
            <label>Region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {regions.map((r) => <option key={r.key} value={r.key}>{r.key.toUpperCase()} · {r.currency}</option>)}
            </select>
          </div>
          {guests != null && <div className="small">Guests detected: <b>{guests}</b></div>}
          <div className="flex-1" />
          <button className="btn lg" onClick={createPipeline} disabled={busy}>
            {busy ? "Building pipeline…" : "Build my pipeline →"}
          </button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
