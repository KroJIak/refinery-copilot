/** Confirmed archival coverage; this is not calculated from the short state slice. */
export type CoverageFact = {
  id: string;
  label: string;
  from: string;
  to: string;
  note: string;
  pattern: "continuous" | "sparse";
};

export const archivalCoverage: CoverageFact[] = [
  { id: "kip-242000", label: "КИП 24-2000", from: "2023-01-01T00:00:00Z", to: "2026-08-07T00:00:00Z", note: "почти сплошная сетка 10 мин", pattern: "continuous" },
  { id: "pak-sulfur", label: "ПАК · сера", from: "2023-01-01T00:00:00Z", to: "2026-08-07T00:00:00Z", note: "с 01.01.2023", pattern: "continuous" },
  { id: "pak-d15", label: "ПАК · D15", from: "2025-03-05T00:00:00Z", to: "2026-08-07T00:00:00Z", note: "только с 05.03.2025; пустой участок до этого — норма", pattern: "continuous" },
  { id: "lims", label: "ЛИМС", from: "2023-01-01T00:00:00Z", to: "2026-08-07T00:00:00Z", note: "редкие асинхронные отборы, обычно около одного в сутки", pattern: "sparse" },
];

export const coverageWindow = { from: "2023-01-01T00:00:00Z", to: "2026-08-07T00:00:00Z" };
