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
// audio playback and ping/pong. We just relay user/agent transcripts.
//
// Connection: prefer WebRTC by agentId (the SDK's robust default — handles audio, NAT
// and keep-alive). Our intake agent is PUBLIC (enable_auth=false), so the SDK fetches a
// conversation token from agentId with no API key. The old signedUrl path forces the
// SDK into raw-WebSocket audio mode, which was dropping the socket right after the
// agent's first line (a flood of "WebSocket is already in CLOSING or CLOSED state").
// A signedUrl is still accepted as a fallback. ─────────────────────────────────────────
export function useElevenLabsAgent(opts: {
  onUserText: (t: string) => void;
  onAgentText?: (t: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const convRef = useRef<{ endSession: () => void; sendContextualUpdate?: (t: string) => void } | null>(null);
  const uRef = useRef(opts.onUserText); uRef.current = opts.onUserText;
  const aRef = useRef(opts.onAgentText); aRef.current = opts.onAgentText;

  const stop = () => {
    const c = convRef.current;
    convRef.current = null;
    if (c) { try { c.endSession(); } catch { /* noop */ } }
    setActive(false);
  };

  const start = async (conn: { agentId?: string; signedUrl?: string },
                       context?: Record<string, string | number | boolean>) => {
    setError("");
    try {
      // load the SDK on demand — keeps it out of the initial bundle
      const { Conversation } = await import("@elevenlabs/client");
      const common: any = {
        // event type / details chosen on screen 1 → the agent starts already knowing them
        ...(context ? { dynamicVariables: context } : {}),
        onConnect: () => setActive(true),
        // details.reason: "agent" (agent ended) | "user" | "error" — surface the real
        // cause instead of the SDK's internal send-on-closed-socket spam.
        onDisconnect: (details?: any) => {
          convRef.current = null;
          setActive(false);
          if (details?.reason === "error") {
            const why = details?.message || details?.context?.reason || "connection dropped";
            setError(why); console.warn("[intake] agent disconnected:", why, details);
          }
        },
        onError: (msg: string, ctx?: any) => { setError(msg || "connection error"); console.warn("[intake] error:", msg, ctx); },
        onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) => {
          if (!message) return;
          if (source === "user") uRef.current?.(message);
          else aRef.current?.(message);
        },
      };
      const session: any = conn.agentId
        ? { agentId: conn.agentId, connectionType: "webrtc", ...common }
        : { signedUrl: conn.signedUrl, connectionType: "websocket", ...common };
      convRef.current = await Conversation.startSession(session);
      // belt-and-suspenders: also tell the agent in plain language, so it knows the
      // event type even if its prompt doesn't template {{event_type}}.
      if (context?.event_type) {
        try {
          convRef.current?.sendContextualUpdate?.(
            `The user is planning a ${String(context.event_type).replace(/_/g, " ")}` +
            (context.guests ? ` for about ${context.guests} guests` : "") +
            (context.city ? ` in ${context.city}` : "") +
            `. Help them plan it — you already know the event type, so don't ask what kind of event it is.`);
        } catch { /* noop */ }
      }
    } catch (e: any) {
      setError(e?.message || "mic/permission error");
      setActive(false);
    }
  };

  useEffect(() => () => stop(), []);
  return { active, error, start, stop };
}
