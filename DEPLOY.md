# Deploying to Render

The whole app ships as **one Docker web service**: FastAPI serves the API, the
live WebSocket stream, and the built React frontend from a single URL. No CORS,
no separate frontend host, no hardcoded backend address.

Why not Vercel? The live dashboard needs a long-lived **WebSocket**, an
**in-process event bus**, and a writable **SQLite** file. Those need a real
always-on process, which Render gives and serverless platforms don't.

## Deploy in 5 steps

1. Push this repo to GitHub (or GitLab).
2. On [render.com](https://render.com): **New → Blueprint**, pick this repo.
   Render reads `render.yaml` and creates the `event-negotiator` web service.
3. Click **Apply**. First build takes ~3–5 min (Node builds the frontend, then
   the Python image starts). Watch the logs until it says *Live*.
4. Open the service URL (e.g. `https://event-negotiator.onrender.com`). Create
   an account and start a negotiation — it runs in **simulation mode** with no
   keys needed.
5. Health check: `https://<your-url>/api/health` should return
   `{"status":"ok", ...}`.

No `render.yaml`? Instead: **New → Web Service → Docker**, point at this repo,
leave the Dockerfile path as `./Dockerfile`, add a `JWT_SECRET` env var.

## Going live (optional)

To let agents make real phone calls and turn the **System Check** green, add
these in the Render dashboard → your service → **Environment**, then redeploy:

| Variable | Where it comes from |
|---|---|
| `CALL_MODE=live` | flips out of simulation |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | ElevenLabs dashboard |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio console |
| `GOOGLE_PLACES_API_KEY` | Google Cloud console |
| `PUBLIC_BASE_URL=https://<your-url>` | so ElevenLabs webhooks reach you |

See `.env.example` for the full list.

## A note on data (free plan)

The free plan's disk is **ephemeral** — accounts and campaigns reset on every
deploy and cold start. That's fine for a demo. For durable data, in
`render.yaml` switch `plan` to `starter` and uncomment the `disk:` +
`DATABASE_URL` block (a persistent disk mounted at `/var/data`).

## Local sanity check (same image as production)

```bash
docker build -t event-negotiator .
docker run -p 8000:8000 event-negotiator
# open http://localhost:8000
```
