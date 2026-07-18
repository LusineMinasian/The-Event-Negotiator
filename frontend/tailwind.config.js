/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        "ink-2": "#334155",
        muted: "#64748b",
        line: "#e2e8f0",
        surface: "#ffffff",
        brand: { DEFAULT: "#4f46e5", 600: "#4f46e5", 700: "#4338ca" },
        violet2: "#7c3aed",
        good: "#059669",
        warn: "#d97706",
        bad: "#e11d48",
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: "12px",
        "2xl": "18px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 10px 30px rgba(15,23,42,0.06)",
        lift: "0 2px 6px rgba(15,23,42,0.06), 0 18px 40px rgba(15,23,42,0.12)",
        brand: "0 1px 2px rgba(79,70,229,0.20), 0 10px 24px rgba(79,70,229,0.28)",
      },
      keyframes: {
        flash: { from: { background: "rgba(5,150,105,0.16)" }, to: { background: "transparent" } },
        pulse2: { "0%,100%": { transform: "scale(1)" }, "50%": { transform: "scale(1.04)" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        flash: "flash 1s ease-out",
        pulse2: "pulse2 1.4s infinite",
        "fade-up": "fade-up 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
