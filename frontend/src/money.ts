// Single source of truth for currency display.
//
// The backend computes everything in a USD base (benchmarks, quotes, ceilings).
// Whatever currency the user picked at the start of the event travels with the
// campaign; here we convert the USD base into that currency for display.
// FX is fixed (demo rates) — the one the user cares about is AMD at 365/USD.
export const RATES: Record<string, number> = { USD: 1, CHF: 1, EUR: 1, AMD: 365 };
export const SYM: Record<string, string> = { USD: "$", CHF: "CHF ", EUR: "€", AMD: "֏ " };

export const rateOf = (currency = "USD") => RATES[currency] ?? 1;
export const symbolOf = (currency = "USD") => SYM[currency] ?? "$";

// Format a USD-base amount in the given currency (converts + adds the symbol).
export function fmtMoney(usd?: number | null, currency = "USD"): string {
  if (usd == null) return "—";
  return symbolOf(currency) + Math.round(usd * rateOf(currency)).toLocaleString();
}

// Inverse: a locally-entered amount back to the USD base we store/compute in.
export const toUsd = (local: number, currency = "USD") => local / rateOf(currency);
export const fromUsd = (usd: number, currency = "USD") => usd * rateOf(currency);
