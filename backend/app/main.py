"""The Event Negotiator — FastAPI entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import auth, campaigns, config_meta, discovery, events, specs, ws

app = FastAPI(title="The Event Negotiator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(events.router)
app.include_router(specs.router)
app.include_router(discovery.router)
app.include_router(campaigns.router)
app.include_router(config_meta.router)
app.include_router(ws.router)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "call_mode": settings.call_mode,
            "live_calls_available": settings.live_calls_available}
