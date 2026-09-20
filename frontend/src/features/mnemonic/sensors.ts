// Static geometry follows docs/frontend/14-page-mnemonic.md. Instrument positions
// are a hypothesis from the supplied data: the KIP directory and CSV codes differ.
export interface SensorDefinition { tag: string; label: string; x: number; y: number; managed?: boolean; lab?: boolean }
export const sensors: SensorDefinition[] = [
  { tag: 'T55', label: 'T55', x: 95, y: 180 },
  { tag: 'F65', label: 'F65', x: 170, y: 180 },
  { tag: 'W70', label: 'W70', x: 95, y: 345 },
  { tag: 'P22', label: 'P22', x: 255, y: 180 },
  { tag: 'T5', label: 'T5', x: 415, y: 180 },
  { tag: 'T6', label: 'T6', x: 490, y: 180 },
  { tag: '24-2000.P8', label: 'P8', x: 700, y: 180, managed: true },
  { tag: '24-2000.T11', label: 'T11', x: 625, y: 180, managed: true },
  { tag: '24-2000.F19', label: 'F19', x: 775, y: 180, managed: true },
  { tag: 'P13', label: 'P13', x: 625, y: 345 },
  { tag: 'F26', label: 'F26', x: 700, y: 345 },
  { tag: 'Q21', label: 'Q21', x: 855, y: 180 },
  { tag: 'D10', label: 'D10', x: 855, y: 345 },
  { tag: 'pak_sulfur', label: 'ПАК сера', x: 925, y: 180 },
  { tag: 'pak_d15', label: 'ПАК D15', x: 925, y: 345 },
  { tag: 'lims_sulfur', label: 'ЛК сера', x: 785, y: 425, lab: true },
  { tag: 'lims_cetane', label: 'ЛК ЦЧ', x: 1200, y: 425, lab: true },
  { tag: 'blend_share_kerosene', label: 'Керосин', x: 1020, y: 140 },
  { tag: 'blend_share_gasoil', label: 'Газойль', x: 1110, y: 140 },
  { tag: 'blend_additive_pct', label: 'Присадка', x: 1200, y: 140, managed: true },
  { tag: 'blend_cetane', label: 'ЦЧ товарного', x: 1140, y: 345 },
  { tag: 'blend_t95', label: 'T95 товарного', x: 1250, y: 345 },
  { tag: 'crude_feed_rate_tph', label: 'Расход нефти', x: 170, y: 425, managed: true },
  { tag: 'avt_furnace_outlet_temp_c', label: 'T печи АВТ', x: 310, y: 425, managed: true },
  { tag: 'avt_column_pressure_mpa_abs', label: 'P колонны АВТ', x: 450, y: 425, managed: true },
];

export const equipment = [
  { x: 70, width: 105, label: 'ЭЛОУ', column: false },
  { x: 205, width: 105, label: 'Печи АВТ', column: false },
  { x: 335, width: 56, label: 'К-1', column: true },
  { x: 413, width: 56, label: 'К-2', column: true },
  { x: 491, width: 56, label: 'К-10', column: true },
  { x: 586, width: 95, label: 'Печи ГО', column: false },
  { x: 710, width: 56, label: 'Р-201', column: true },
  { x: 790, width: 56, label: 'Р-202', column: true },
  { x: 985, width: 135, label: 'Блендинг', column: false },
  { x: 1170, width: 135, label: 'Товарный ДТ', column: false },
];
