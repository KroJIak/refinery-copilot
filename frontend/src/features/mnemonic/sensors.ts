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
  { tag: 'F65', label: 'Расход колонны', x: 165, y: 258 },
  { tag: 'T55', label: 'Температура печи П-3', x: 412, y: 250 },
  { tag: 'W70', label: 'Уровень', x: 526, y: 250 },
  { tag: 'feed_sulfur', label: 'Сера сырья', x: 584, y: 250 },
  { tag: '24-2000.T5', label: 'Температура реактора', x: 470, y: 484 },
  { tag: '24-2000.T6', label: 'Температура низа', x: 535, y: 484 },

  { tag: '24-2000.T11', label: 'Температура входа', x: 807, y: 250, managed: true },
  { tag: '24-2000.F26', label: 'Расход продукта', x: 887, y: 250, managed: true },
  { tag: '24-2000.F19', label: 'Давление реактора', x: 967, y: 250, managed: true },
  { tag: '24-2000.P13', label: 'Давление ряда P13', x: 1015, y: 484 },
  { tag: 'Q21', label: 'Сера анализатора', x: 900, y: 484 },
  { tag: 'd15', label: 'Плотность лаборатории', x: 812, y: 484, lab: true },
  { tag: 'sulfur', label: 'Сера лаборатории', x: 1043, y: 507, lab: true },

  { tag: 'blend_share_kerosene', label: 'Керосин', x: 1190, y: 250 },
  { tag: 'blend_share_gasoil', label: 'Газойль', x: 1265, y: 250 },
  { tag: 'blend_additive_pct', label: 'Присадка', x: 1340, y: 250, managed: true },
  { tag: 'cetane', label: 'Цетановое лаборатории', x: 1230, y: 484, lab: true },
  { tag: 't95', label: 'Выкипание лаборатории', x: 1325, y: 484, lab: true },
];
