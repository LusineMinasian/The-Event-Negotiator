import { useEffect, useRef, useState } from "react";
import { campaignSocketUrl } from "./api";

export type WsEvent = { type: string; payload: any };

// Subscribe to a campaign's live event stream. Replays history on connect.
export function useCampaignSocket(campaignId: string | null, onEvent: (e: WsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!campaignId) return;
    const ws = new WebSocket(campaignSocketUrl(campaignId));
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (m) => {
      try {
        cb.current(JSON.parse(m.data));
      } catch {}
    };
    return () => ws.close();
  }, [campaignId]);

  return { connected };
}
