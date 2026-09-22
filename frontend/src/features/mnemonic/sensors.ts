// Coordinates are intentionally kept alongside the static process layout. They follow
// the high-level AVT chain in docs/internal, rather than asserting a piping drawing.
export interface SensorDefinition {
  tag: string;
  label: string;
  x: number;
  y: number;
  managed?: boolean;
  lab?: boolean;
}

export const sensors: SensorDefinition[] = [
  { tag: 'crude_feed_rate_tph', label: 'Расход нефти', x: 165, y: 258, managed: true },
  { tag: 'T55', label: 'Температура колонны', x: 412, y: 250 },
  { tag: 'F65', label: 'Расход колонны', x: 468, y: 250 },
  { tag: 'W70', label: 'Уровень', x: 526, y: 250 },
  { tag: 'P22', label: 'Давление верха', x: 584, y: 250 },
  { tag: 'T5', label: 'Температура реактора', x: 470, y: 484 },
  { tag: 'T6', label: 'Температура низа', x: 535, y: 484 },
  { tag: 'avt_furnace_outlet_temp_c', label: 'T печи', x: 400, y: 484, managed: true },
  { tag: 'avt_column_pressure_mpa_abs', label: 'P колонны', x: 605, y: 484, managed: true },

  { tag: '24-2000.T11', label: 'Расход в реактор', x: 807, y: 250, managed: true },
  { tag: '24-2000.P8', label: 'Температура входа', x: 867, y: 250, managed: true },
  { tag: '24-2000.F19', label: 'Давление реактора', x: 927, y: 250, managed: true },
  { tag: 'P13', label: 'Перепад давления', x: 987, y: 250 },
  { tag: 'F26', label: 'Расход продукта', x: 1015, y: 484 },
  { tag: 'Q21', label: 'Сера анализатора', x: 950, y: 484 },
  { tag: 'pak_sulfur', label: 'Сера поточного анализа', x: 880, y: 484 },
  { tag: 'pak_d15', label: 'Плотность поточного анализа', x: 812, y: 484 },
  { tag: 'lims_sulfur', label: 'Сера лаборатории', x: 1043, y: 507, lab: true },

  { tag: 'blend_share_kerosene', label: 'Керосин', x: 1190, y: 250 },
  { tag: 'blend_share_gasoil', label: 'Газойль', x: 1265, y: 250 },
  { tag: 'blend_additive_pct', label: 'Присадка', x: 1340, y: 250, managed: true },
  { tag: 'blend_cetane', label: 'Цетановое товарного', x: 1230, y: 484 },
  { tag: 'blend_t95', label: 'Выкипание товарного', x: 1325, y: 484 },
  { tag: 'lims_cetane', label: 'Цетановое лаборатории', x: 1425, y: 492, lab: true },
  { tag: 'D10', label: 'Канал без сигнала', x: 1518, y: 492 },
];
