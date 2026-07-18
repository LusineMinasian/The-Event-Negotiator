"""In-memory event bus (replaces Redis Streams for a single-process demo).
Each campaign gets a fan-out of asyncio queues; WebSocket clients subscribe."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


QUEUE_MAXSIZE = 2000  # per-subscriber cap; a stalled client drops its oldest, never OOMs the process


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._history: dict[str, list[dict]] = defaultdict(list)
        self._seq = 0  # monotonic id so late subscribers can de-dupe replayed vs live events

    def subscribe(self, campaign_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self._subs[campaign_id].append(q)
        return q

    def unsubscribe(self, campaign_id: str, q: asyncio.Queue) -> None:
        if q in self._subs.get(campaign_id, []):
            self._subs[campaign_id].remove(q)

    def history(self, campaign_id: str) -> list[dict]:
        return list(self._history.get(campaign_id, []))

    async def publish(self, campaign_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self._seq += 1
        msg = {"seq": self._seq, "type": event_type, "payload": payload}
        self._history[campaign_id].append(msg)
        for q in list(self._subs.get(campaign_id, [])):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # slow/stalled subscriber: drop its oldest event to make room, never block publishers
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    pass


bus = EventBus()
