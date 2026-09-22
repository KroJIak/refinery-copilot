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
  { tag: 'T55', label: 'T55', x: 412, y: 250 },
  { tag: 'F65', label: 'F65', x: 468, y: 250 },
  { tag: 'W70', label: 'W70', x: 526, y: 250 },
  { tag: 'P22', label: 'P22', x: 584, y: 250 },
  { tag: 'T5', label: 'T5', x: 470, y: 484 },
  { tag: 'T6', label: 'T6', x: 535, y: 484 },
  { tag: 'avt_furnace_outlet_temp_c', label: 'T печи', x: 400, y: 484, managed: true },
  { tag: 'avt_column_pressure_mpa_abs', label: 'P колонны', x: 605, y: 484, managed: true },

  { tag: '24-2000.T11', label: 'T11', x: 807, y: 250, managed: true },
  { tag: '24-2000.P8', label: 'P8', x: 867, y: 250, managed: true },
  { tag: '24-2000.F19', label: 'F19', x: 927, y: 250, managed: true },
  { tag: 'P13', label: 'P13', x: 987, y: 250 },
  { tag: 'F26', label: 'F26', x: 1015, y: 484 },
  { tag: 'Q21', label: 'Q21', x: 950, y: 484 },
  { tag: 'pak_sulfur', label: 'ПАК сера', x: 880, y: 484 },
  { tag: 'pak_d15', label: 'ПАК D15', x: 812, y: 484 },
  { tag: 'lims_sulfur', label: 'ЛК сера', x: 1043, y: 507, lab: true },

  { tag: 'blend_share_kerosene', label: 'Керосин', x: 1190, y: 250 },
  { tag: 'blend_share_gasoil', label: 'Газойль', x: 1265, y: 250 },
  { tag: 'blend_additive_pct', label: 'Присадка', x: 1340, y: 250, managed: true },
  { tag: 'blend_cetane', label: 'ЦЧ товарного', x: 1230, y: 484 },
  { tag: 'blend_t95', label: 'T95 товарного', x: 1325, y: 484 },
  { tag: 'lims_cetane', label: 'ЛК ЦЧ', x: 1425, y: 492, lab: true },
  { tag: 'D10', label: 'D10', x: 1518, y: 492 },
];
