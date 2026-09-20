import type { QualityAssessment, Recommendation, TagPoint } from "@/types";
import type { SeriesInput } from "./TimeSeriesChart";

export function sulfurSeries(
  tags: TagPoint[],
  tPoint: string | null,
  card?: Recommendation | null,
  quality: QualityAssessment[] = [],
): SeriesInput[] {
  const sulfur = tags.filter((point) => /Q21|sulfur/i.test(point.tagCode));
  const telemetry = sulfur.filter((point) => point.source !== "lims");
  const tag = telemetry[0]?.tagCode;
  const points = telemetry
    .filter((point) => point.tagCode === tag)
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const result: SeriesInput[] = [
    {
      tagCode: tag ?? "Q21",
      unit: points[0]?.unit ?? null,
      points,
      kind: "telemetry",
    },
    {
      tagCode: "lims_sulfur",
      unit: "мг/кг",
      points: sulfur.filter((point) => point.source === "lims"),
      kind: "lims_fact",
    },
  ];
  const prediction = quality.find((item) => item.target === "sulfur");
  const risk = card?.risks.find((item) => item.target === "sulfur");
  if (tPoint && card?.decision === "recommend" && (prediction || risk)) {
    const assessment = prediction ?? risk!;
    const end = new Date(
      Date.parse(tPoint) + (prediction?.horizonH ?? 3) * 3_600_000,
    ).toISOString();
    const make = (ts: string, value: number): TagPoint => ({
      tagCode: "sulfur_forecast",
      ts,
      value,
      qualityFlag: "ok",
      source: "vak",
      unit: "мг/кг",
    });
    const initial =
      [...points]
        .reverse()
        .find((point) => point.value !== null && point.qualityFlag === "ok")
        ?.value ?? assessment.p50;
    result.push({
      tagCode: "sulfur_forecast",
      unit: "мг/кг",
      kind: "forecast",
      points: [make(tPoint, initial), make(end, assessment.p50)],
      p10: [make(tPoint, initial), make(end, assessment.p10)],
      p90: [make(tPoint, initial), make(end, assessment.p90)],
    });
  }
  return result;
}
