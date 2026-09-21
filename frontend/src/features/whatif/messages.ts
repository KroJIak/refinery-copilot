/** Converts technical constraint identifiers from the API into user-facing copy. */
export function violationMessage(value: string): string {
  const [first, ...rest] = value.split(':');
  const code = first ?? '';
  const labels: Record<string, string> = {
    sulfur_max: 'Сера',
    t95_max: 'T95',
    cetane_min_summer: 'Цетановое число',
    blend_additive_pct: 'Доля присадки',
    blend_shares: 'Доли компонентов',
  };
  const detail = rest.join(':').trim();
  return labels[code] ? `${labels[code]}: ${detail || 'нарушено ограничение'}` : value.replace(/^[a-z_]+:\s*/, '');
}
