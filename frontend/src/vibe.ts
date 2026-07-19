// Pure parsing + color helpers for the interactive voice studio. No React, no DOM
// (except imageColors which needs a canvas) — kept separate so it can be unit-tested.

export type ColorHit = { name: string; hex: string };

// Event-friendly color vocabulary. Multi-word names are matched first.
export const COLOR_MAP: Record<string, string> = {
  "rose gold": "#b76e79", "dusty blue": "#8ca3bd", "dusty rose": "#c9989a",
  "blush pink": "#e8b7c0", "sage green": "#a8bfa0", "navy blue": "#26324f",
  "forest green": "#2f5d43", "burnt orange": "#c1571f", "baby blue": "#9ec9e8",
  "baby pink": "#f4c2cc", "hot pink": "#e0348b",
  blush: "#e8b7c0", sage: "#a8bfa0", burgundy: "#7b2233", ivory: "#f4efe6",
  gold: "#d4af37", champagne: "#e8d5a8", terracotta: "#c66a4e", coral: "#f18f7a",
  lavender: "#b9a3d6", emerald: "#0f8a5f", navy: "#26324f", teal: "#1f8a86",
  peach: "#f6c8a8", mint: "#a8e0c8", mustard: "#d4a017", plum: "#7a3b62",
  cream: "#f3ead9", charcoal: "#33373d", rust: "#a8432a", olive: "#7a7a3a",
  lilac: "#c3a6d6", turquoise: "#2ec4b6", magenta: "#c0328b", maroon: "#6a1f2b",
  red: "#d62839", orange: "#f07818", yellow: "#f2c53d", green: "#2f9e57",
  blue: "#2a6fd6", purple: "#7a4fc0", pink: "#e86ea0", white: "#f5f5f5",
  black: "#20242b", gray: "#8a94a6", grey: "#8a94a6", brown: "#7a4f37",
  silver: "#c0c6cf", beige: "#e6dcc8",
};

// Descriptive "vibe" words worth turning into hashtag bubbles.
export const VIBE_WORDS = [
  "rustic", "elegant", "boho", "bohemian", "minimal", "minimalist", "vintage", "modern",
  "classic", "romantic", "tropical", "fairytale", "glamorous", "glam", "cozy", "outdoor",
  "indoor", "garden", "beach", "luxury", "luxe", "whimsical", "industrial", "moody",
  "bright", "pastel", "vibrant", "intimate", "grand", "festive", "playful", "chic",
  "candles", "flowers", "florals", "greenery", "balloons", "fairy lights", "live music",
  "dj", "photobooth", "buffet", "cocktails", "dinner", "brunch", "dessert", "cake",
];

const EVENT_KEYWORDS: Record<string, string[]> = {
  wedding: ["wedding", "marry", "married", "bride", "groom", "engagement"],
  birthday: ["birthday", "bday", "turning", "birth day"],
  baby_shower: ["baby shower", "baby-shower", "gender reveal", "newborn", "baby"],
  hackathon: ["hackathon", "hack day", "hackfest", "devfest", "coding event", "makeathon"],
  public_speaking: ["public speaking", "conference", "keynote", "seminar", "summit", "meetup", "panel", "lecture", "talk"],
  concert: ["concert", "gig", "live music", "music festival", "live band show"],
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "want", "would", "like", "need",
  "have", "some", "this", "that", "our", "were", "are", "will", "going", "make", "really",
  "very", "just", "about", "there", "their", "them", "into", "from", "your", "you", "its",
]);

const norm = (t: string) => t.toLowerCase().replace(/[.,!?;:()"]/g, " ");

export function detectColors(text: string): ColorHit[] {
  let t = norm(text);
  const hits: ColorHit[] = [];
  const seen = new Set<string>();
  // longest names first so "sage green" wins; blank the matched span so its component
  // words ("green") don't re-match as separate colors.
  const names = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "gi");
    if (re.test(t)) {
      t = t.replace(re, " ".repeat(name.length));
      if (!seen.has(COLOR_MAP[name])) {
        seen.add(COLOR_MAP[name]);
        hits.push({ name, hex: COLOR_MAP[name] });
      }
    }
  }
  return hits;
}

export function detectEventType(text: string): string | null {
  const t = norm(text);
  for (const [key, words] of Object.entries(EVENT_KEYWORDS)) {
    if (words.some((w) => t.includes(w))) return key;
  }
  return null;
}

export function detectGuests(text: string): number | null {
  const m = norm(text).match(/(\d{1,4})\s*(guests?|people|pax|attendees|persons?)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

export function detectVibeWords(text: string): string[] {
  const t = norm(text);
  const out: string[] = [];
  for (const w of VIBE_WORDS) {
    const re = new RegExp(`\\b${w.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(t)) out.push(w);
  }
  return out;
}

// Fallback nouns/adjectives when nothing structured matched — keeps the canvas alive.
export function extractKeywords(text: string): string[] {
  return Array.from(new Set(
    norm(text).split(/\s+/).filter((w) => w.length > 4 && !STOP.has(w) && !/^\d+$/.test(w)),
  )).slice(0, 3);
}

export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return rgbToHex(mix(r), mix(g), mix(b));
}

export function readableText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1a1f2b" : "#ffffff";
}

// Build palette-engine theme tokens from a set of collected colors, so the whole page
// recolors exactly like the inspiration-board path does.
export function buildThemeTokens(colors: string[]) {
  if (colors.length === 0) return null;
  const accent = colors[0];
  const stops = [
    lighten(colors[0], 0.86),
    lighten(colors[Math.min(1, colors.length - 1)], 0.9),
    lighten(colors[Math.min(2, colors.length - 1)], 0.92),
  ];
  return {
    accent,
    surface_tint: lighten(accent, 0.9),
    border_tint: lighten(accent, 0.75),
    gradient_stops: stops,
    contrast_verified: true,
  };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "").trim();
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
}

// Extract a few dominant colors from an already-loaded <img> via a small canvas.
// Buckets colors coarsely and returns the most common vivid ones.
export function imageColors(img: HTMLImageElement, count = 3): string[] {
  const W = 48, H = 48;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return []; // tainted canvas (cross-origin) — skip
  }
  const buckets: Record<string, { n: number; r: number; g: number; b: number; sat: number }> = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bk = (buckets[key] ||= { n: 0, r: 0, g: 0, b: 0, sat: 0 });
    bk.n++; bk.r += r; bk.g += g; bk.b += b; bk.sat += sat;
  }
  return Object.values(buckets)
    .map((bk) => ({ hex: rgbToHex(Math.round(bk.r / bk.n), Math.round(bk.g / bk.n), Math.round(bk.b / bk.n)), score: bk.n * (0.4 + bk.sat / bk.n) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.hex);
}
