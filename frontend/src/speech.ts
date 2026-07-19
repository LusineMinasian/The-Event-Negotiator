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

// ── ElevenLabs Conversational AI (realtime), via the official @elevenlabs/client SDK.
// The SDK owns the hard parts — mic capture (AudioWorklet), server VAD / turn-taking,
// audio playback and ping/pong — which a hand-rolled WebSocket got wrong (the agent
// spoke once then never heard the user). We just relay user/agent transcripts. Activates
// only when the backend returns a signed URL (keys + agent configured). ────────────────
export function useElevenLabsAgent(opts: {
  onUserText: (t: string) => void;
  onAgentText?: (t: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const convRef = useRef<{ endSession: () => void } | null>(null);
  const uRef = useRef(opts.onUserText); uRef.current = opts.onUserText;
  const aRef = useRef(opts.onAgentText); aRef.current = opts.onAgentText;

  const stop = () => {
    const c = convRef.current;
    convRef.current = null;
    if (c) { try { c.endSession(); } catch { /* noop */ } }
    setActive(false);
  };

  const start = async (signedUrl: string) => {
    setError("");
    try {
      // load the SDK on demand — keeps it out of the initial bundle
      const { Conversation } = await import("@elevenlabs/client");
      convRef.current = await Conversation.startSession({
        signedUrl,
        connectionType: "websocket",
        onConnect: () => setActive(true),
        onDisconnect: () => setActive(false),
        onError: (msg: string) => setError(msg || "connection error"),
        onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) => {
          if (!message) return;
          if (source === "user") uRef.current?.(message);
          else aRef.current?.(message);
        },
      });
    } catch (e: any) {
      setError(e?.message || "mic/permission error");
      setActive(false);
    }
  };

  useEffect(() => () => stop(), []);
  return { active, error, start, stop };
}
