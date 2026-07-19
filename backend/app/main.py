"""SayWhen — FastAPI entrypoint."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, settings
from .db import init_db
from .routers import (agent_tools, auth, campaigns, config_meta, discovery, events, intake,
                      integrations, settings as settings_router, specs, telephony, ws)

app = FastAPI(title="SayWhen", version="1.0.0")

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
app.include_router(intake.router)
app.include_router(integrations.router)
app.include_router(settings_router.router)
app.include_router(agent_tools.router)
app.include_router(telephony.router)
app.include_router(ws.router)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "call_mode": settings.call_mode,
            "live_calls_available": settings.live_calls_available}


# --- Serve the built frontend (single-service deploy, e.g. Render) ---------
# When the frontend is built (Vite -> dist), FastAPI serves it from the same
# origin. Relative "/api" and same-host WebSocket URLs then work with no CORS.
_frontend_dist = os.environ.get("FRONTEND_DIST") or str(BASE_DIR.parent / "frontend" / "dist")
_dist = Path(_frontend_dist)

if (_dist / "index.html").is_file():
    _assets = _dist / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> FileResponse:
        # API/WS routes are registered above and take precedence; anything left
        # under /api that reaches here is a genuine 404, not the SPA shell.
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not found")
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
