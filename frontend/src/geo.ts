// Country + city data for the event-creation wizard. Kept offline (no API key, works
// everywhere) and scoped to the regions the backend actually benchmarks (us_ca, eu_de_ch).
// City lists are a curated set of major cities per country — enough for a real-feeling
// autocomplete without shipping a 150k-row dataset.

export type Country = {
  code: string; name: string; flag: string;
  region_profile: string; currency: string; symbol: string;
};

export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", flag: "🇺🇸", region_profile: "us_ca", currency: "USD", symbol: "$" },
  { code: "CA", name: "Canada", flag: "🇨🇦", region_profile: "us_ca", currency: "USD", symbol: "$" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭", region_profile: "eu_de_ch", currency: "CHF", symbol: "CHF " },
  { code: "DE", name: "Germany", flag: "🇩🇪", region_profile: "eu_de_ch", currency: "CHF", symbol: "CHF " },
  { code: "AT", name: "Austria", flag: "🇦🇹", region_profile: "eu_de_ch", currency: "CHF", symbol: "CHF " },
];

export const CITIES: Record<string, string[]> = {
  US: ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "San Diego", "Dallas",
    "San Jose", "Austin", "San Francisco", "Seattle", "Boston", "Miami", "Atlanta", "Denver",
    "Portland", "Las Vegas", "Nashville", "Washington", "Philadelphia", "New Orleans", "Minneapolis"],
  CA: ["Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa", "Winnipeg",
    "Quebec City", "Hamilton", "Victoria", "Halifax", "Kitchener"],
  CH: ["Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Lucerne", "St. Gallen", "Lugano",
    "Winterthur", "Zug", "Fribourg", "Neuchâtel"],
  DE: ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf",
    "Leipzig", "Dortmund", "Dresden", "Nuremberg", "Hanover", "Bremen", "Freiburg"],
  AT: ["Vienna", "Graz", "Linz", "Salzburg", "Innsbruck", "Klagenfurt", "Villach", "Wels", "Bregenz"],
};

export function countryByCode(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];
}

// Detect the visitor's country from the browser — locale region subtag first (instant,
// no permission prompt), then a coarse timezone fallback. Maps onto the nearest supported
// country so currency/benchmarks stay meaningful.
export function detectCountry(): string {
  const supported = new Set(COUNTRIES.map((c) => c.code));
  const langs: string[] = (navigator.languages && navigator.languages.length)
    ? [...navigator.languages] : [navigator.language || ""];
  for (const l of langs) {
    const m = l.match(/[-_]([A-Za-z]{2})\b/);
    if (m) {
      const cc = m[1].toUpperCase();
      if (supported.has(cc)) return cc;
    }
    // language-only hints
    if (/^de\b/i.test(l)) return "DE";
    if (/^fr[-_]?ch/i.test(l)) return "CH";
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz.includes("Zurich")) return "CH";
    if (tz.includes("Berlin")) return "DE";
    if (tz.includes("Vienna")) return "AT";
    if (tz.startsWith("America/")) return tz.includes("Toronto") || tz.includes("Vancouver") ? "CA" : "US";
    if (tz.startsWith("Europe/")) return "DE";
  } catch { /* noop */ }
  return "US";
}

export function citiesFor(code: string): string[] {
  return CITIES[code] || [];
}
