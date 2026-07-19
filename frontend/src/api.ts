const TOKEN_KEY = "en_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req(method: string, path: string, body?: any, isForm = false): Promise<any> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let payload: any = undefined;
  if (body && !isForm) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (isForm) {
    payload = body;
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const api = {
  // auth
  register: (email: string, password: string, name: string) =>
    req("POST", "/auth/register", { email, password, name }),
  login: (email: string, password: string) => req("POST", "/auth/login", { email, password }),
  me: () => req("GET", "/auth/me"),

  // config
  meta: () => req("GET", "/config/meta"),
  segments: (category?: string, event?: string) => {
    const q = new URLSearchParams();
    if (category) q.set("category", category);
    if (event) q.set("event", event);
    return req("GET", `/config/segments?${q}`);
  },
  eventConfig: (key: string) => req("GET", `/config/event/${key}`),
  behaviorGet: (key: string) =>
    req("GET", `/config/segments/${encodeURIComponent(key)}/behavior`),
  behaviorSet: (key: string, body: { prioritized: string[]; muted: string[] }) =>
    req("POST", `/config/segments/${encodeURIComponent(key)}/behavior`, body),
  behaviorClear: (key: string) =>
    req("DELETE", `/config/segments/${encodeURIComponent(key)}/behavior`),

  // events + specs
  createEvent: (type: string, region_profile: string) =>
    req("POST", "/events", { type, region_profile }),
  listEvents: () => req("GET", "/events"),
  getSpec: (id: string) => req("GET", `/specs/${id}`),
  patchSpec: (id: string, payload: any) => req("PATCH", `/specs/${id}`, { payload }),
  uploadBoard: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("POST", `/specs/${id}/board`, fd, true);
  },
  confirmSpec: (id: string) => req("POST", `/specs/${id}/confirm`),
  parseDocument: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("POST", "/intake/parse-document", fd, true);
  },
  reopenSpec: (id: string) => req("POST", `/specs/${id}/reopen`),

  // discovery + campaign
  discover: (specId: string, target = 4) =>
    req("POST", `/specs/${specId}/discover?target_per_category=${target}`),
  patchVendor: (id: string, body: any) => req("PATCH", `/vendors/${id}`, body),
  vendorDetails: (id: string) => req("GET", `/vendors/${id}/details`),
  startCampaign: (id: string) => req("POST", `/campaigns/${id}/start`),
  campaign: (id: string) => req("GET", `/campaigns/${id}`),
  callDetail: (cid: string, callId: string) => req("GET", `/campaigns/${cid}/calls/${callId}`),
  resolveHandoff: (cid: string, callId: string) =>
    req("POST", `/campaigns/${cid}/calls/${callId}/handoff/resolve`),
  resolveQuestion: (cid: string, callId: string, answer: string) =>
    req("POST", `/campaigns/${cid}/calls/${callId}/question/resolve`, { answer }),
  metrics: (id: string) => req("GET", `/campaigns/${id}/metrics`),
  receipt: (id: string) => req("GET", `/campaigns/${id}/receipt`),
  postmortem: (id: string) => req("GET", `/campaigns/${id}/postmortem`),

  // integrations
  elevenlabsStatus: () => req("GET", "/integrations/elevenlabs"),
  preflight: () => req("GET", "/integrations/preflight"),
  intakeSignedUrl: () => req("GET", "/integrations/elevenlabs/intake-signed-url"),
  inspirationLink: (specId: string, url: string) =>
    req("POST", `/specs/${specId}/inspiration/link`, { url }),
};

export function campaignSocketUrl(campaignId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/ws/campaigns/${campaignId}?token=${getToken()}`;
}
