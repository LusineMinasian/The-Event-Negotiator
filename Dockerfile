# SayWhen — single-service image for Render.
# Stage 1 builds the Vite frontend; stage 2 runs FastAPI and serves that build
# plus the API and WebSocket from one origin (no CORS, no hardcoded URLs).

# ---- Stage 1: build the frontend -----------------------------------------
FROM node:20-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime --------------------------------------------
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FRONTEND_DIST=/app/frontend/dist

WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/backend/
COPY --from=frontend /frontend/dist /app/frontend/dist

# Render provides $PORT at runtime; default to 8000 for local `docker run`.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
