const labels: Record<string, string> = {
  sulfur_max: 'сера выше 10 мг/кг',
  t95_max: 'температура выкипания выше 360 °C',
  cetane_min_summer: 'цетановое число ниже 51',
  cetane_min_winter: 'цетановое число ниже 49',
  density_range: 'плотность вне 820–845 кг/м³',
  blend_additive_pct: 'присадки больше 3 %',
  blend_shares: 'доли компонентов не сходятся в 100 %',
  range_t5: 'температура реактора вне рабочего диапазона',
};

export function violationMessage(value: string): string {
  const code = value.split(':')[0]?.trim() ?? '';
  return labels[code] ?? 'ограничение нарушено';
}
