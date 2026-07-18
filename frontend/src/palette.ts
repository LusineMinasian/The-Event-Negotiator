// Palette Engine (client half of spec section 21). Applies extracted theme tokens
// as CSS custom properties on :root, with a smooth transition so the viewer sees
// the UI recolor to their inspiration board.
export type ThemeTokens = {
  accent?: string;
  surface_tint?: string;
  border_tint?: string;
  gradient_stops?: string[];
  contrast_verified?: boolean;
};

export function applyTheme(tokens: ThemeTokens | null | undefined) {
  const root = document.documentElement;
  if (!tokens || !tokens.gradient_stops || tokens.gradient_stops.length < 3) {
    clearTheme();
    return;
  }
  root.style.setProperty("--palette-accent", tokens.accent || "#c98a92");
  root.style.setProperty("--palette-surface", tokens.surface_tint || "#fbf6f5");
  root.style.setProperty("--palette-border", tokens.border_tint || "#eadfe0");
  root.style.setProperty("--palette-g1", tokens.gradient_stops[0]);
  root.style.setProperty("--palette-g2", tokens.gradient_stops[1]);
  root.style.setProperty("--palette-g3", tokens.gradient_stops[2]);
  root.dataset.themed = "true";
}

export function clearTheme() {
  const root = document.documentElement;
  delete root.dataset.themed;
  // also drop the injected palette vars so a previous board's colors don't linger
  for (const v of ["--palette-accent", "--palette-surface", "--palette-border",
                   "--palette-g1", "--palette-g2", "--palette-g3"]) {
    root.style.removeProperty(v);
  }
}
