import { useEffect, useRef, useState } from "react";

// ── Browser speech-to-text (Web Speech API). In Chrome this is Google's recognizer —
// the always-available voice path that needs no API keys. ────────────────────────────
export function useSpeechRecognition(
  onFinal: (text: string) => void,
  onInterim?: (text: string) => void,
) {
  const [supported] = useState(
    () => typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
  );
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const wantRef = useRef(false);
  const fRef = useRef(onFinal); fRef.current = onFinal;
  const iRef = useRef(onInterim); iRef.current = onInterim;

  const start = () => {
    if (!supported || recRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fRef.current?.(r[0].transcript);
        else interim += r[0].transcript;
      }
      iRef.current?.(interim);
    };
    rec.onend = () => {
      if (wantRef.current) { try { rec.start(); } catch { /* already started */ } }
      else { setListening(false); recRef.current = null; }
    };
    rec.onerror = () => {};
    recRef.current = rec;
    wantRef.current = true;
    try { rec.start(); setListening(true); } catch { /* noop */ }
  };

  const stop = () => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  };

  useEffect(() => () => { wantRef.current = false; try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  return { supported, listening, start, stop };
}

// ── ElevenLabs Conversational AI (realtime). Protocol-correct wiring: streams mic PCM16
// up, plays agent PCM16 down, and surfaces user/agent transcripts. Activates only when
// the backend returns a signed URL (i.e. keys + agent configured). Verified against the
// documented convai WS protocol; not exercised in this keyless environment. ────────────
export function useElevenLabsAgent(opts: {
  onUserText: (t: string) => void;
  onAgentText?: (t: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAtRef = useRef(0);
  const uRef = useRef(opts.onUserText); uRef.current = opts.onUserText;
  const aRef = useRef(opts.onAgentText); aRef.current = opts.onAgentText;

  const stop = () => {
    try { wsRef.current?.close(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { ctxRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null; streamRef.current = null; ctxRef.current = null;
    setActive(false);
  };

  const start = async (signedUrl: string) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      ctxRef.current = ctx;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ws = new WebSocket(signedUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setActive(true);
        const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        src.connect(proc); proc.connect(ctx.destination);
        proc.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const f32 = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(f32.length);
          for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
          ws.send(JSON.stringify({ user_audio_chunk: b64(new Uint8Array(pcm.buffer)) }));
        };
      };

      ws.onmessage = (m) => {
        let msg: any; try { msg = JSON.parse(m.data); } catch { return; }
        if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong", event_id: msg.ping_event?.event_id })); return; }
        if (msg.type === "user_transcript") { const t = msg.user_transcription_event?.user_transcript; if (t) uRef.current?.(t); }
        if (msg.type === "agent_response") { const t = msg.agent_response_event?.agent_response; if (t) aRef.current?.(t); }
        if (msg.type === "audio") { const a = msg.audio_event?.audio_base_64; if (a) playPcm(ctx, playAtRef, a); }
      };
      ws.onerror = () => setError("connection error");
      ws.onclose = () => setActive(false);
    } catch (e: any) {
      setError(e?.message || "mic/permission error");
      stop();
    }
  };

  useEffect(() => () => stop(), []);
  return { active, error, start, stop };
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function playPcm(ctx: AudioContext, playAtRef: { current: number }, base64Pcm: string) {
  const bin = atob(base64Pcm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const buf = ctx.createBuffer(1, pcm.length, 16000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
  const node = ctx.createBufferSource();
  node.buffer = buf; node.connect(ctx.destination);
  const now = ctx.currentTime;
  const at = Math.max(now, playAtRef.current);
  node.start(at);
  playAtRef.current = at + buf.duration;
}
