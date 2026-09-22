import { IconBuildingFactory2, IconDroplet, IconFlask, IconGasStation, IconMinus, IconPlus, IconRotate, IconStack2 } from '@tabler/icons-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { Icon } from '@tabler/icons-react';
import type { TagPoint } from '@/types';
import type { SensorDefinition } from './sensors';

export type SensorVisualState = 'ok' | 'warn' | 'stale' | 'missing';

type Props = {
  sensors: SensorDefinition[];
  latest: Map<string, TagPoint>;
  selected: string | null;
  influence: string;
  getState: (tag: TagPoint | undefined) => SensorVisualState;
  onSelect: (tag: string) => void;
  onBackgroundClick: () => void;
};

type StageProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
  tone: 'crude' | 'process' | 'product';
  Icon: Icon;
};

const stateLabels: Record<SensorVisualState, string> = {
  ok: 'в норме',
  warn: 'близко к границе',
  stale: 'нарушение',
  missing: 'нет данных / не верим',
};

const influencePaths: Record<string, string> = {
  '24-2000.T11': 'M822 283 V236 H1080 V326 H1330 V445',
  '24-2000.F26': 'M900 283 V236 H1080 V326 H1330 V445',
  '24-2000.F19': 'M960 283 V236 H1080 V326 H1330 V445',
  avt: 'M510 283 V236 H1080 V326 H1330 V445',
  blend_additive_pct: 'M1210 225 V326 H1330 V445',
};

const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

function Stage({ x, y, width, height, title, lines, tone, Icon }: StageProps) {
  const titleY = y + 72;
  return <g className={`process-stage process-stage--${tone}`}>
    <rect x={x} y={y} width={width} height={height} rx="22" />
    <Icon x={x + 24} y={y + 24} width={29} height={29} strokeWidth={1.75} aria-hidden="true" />
    <text className="process-stage-title" x={x + width / 2} y={titleY}>{title}</text>
    {lines.map((line, index) => <text className="process-stage-line" key={line} x={x + width / 2} y={titleY + 27 + index * 22}>{line}</text>)}
  </g>;
}

function Marker({ x, y, children, variant }: { x: number; y: number; children: string; variant: 'managed' | 'lab' }) {
  return <g className={`process-marker process-marker--${variant}`}>
    <circle cx={x} cy={y} r="19" />
    <text x={x} y={y + 5}>{children}</text>
  </g>;
}

/** Static process layout follows the supplied chain diagram from docs/internal/raw. */
export function ProcessDiagram({ sensors, latest, selected, influence, getState, onSelect, onBackgroundClick }: Props) {
  return <TransformWrapper
    minScale={0.4}
    maxScale={2.5}
    fitOnInit="contain"
    limitToBounds
    wheel={{ step: 0.02, disabled: false, touchPadDisabled: false }}
    panning={{ excluded: ['sensor-hit', 'sensor-hit-area', 'mnemonic-control'] }}
    doubleClick={{ mode: 'reset' }}
  >
    {({ zoomIn, zoomOut, resetTransform }) => <>
      <div className="mnemonic-zoom" aria-label="Масштаб схемы">
        <button className="mnemonic-control" type="button" onClick={() => zoomIn()} aria-label="Увеличить схему"><IconPlus aria-hidden="true" /></button>
        <button className="mnemonic-control" type="button" onClick={() => zoomOut()} aria-label="Уменьшить схему"><IconMinus aria-hidden="true" /></button>
        <button className="mnemonic-control mnemonic-reset" type="button" onClick={() => resetTransform()} aria-label="Сбросить масштаб" title="Сбросить масштаб"><IconRotate aria-hidden="true" /></button>
      </div>
      <TransformComponent
        wrapperClass="mnemonic-transform"
        contentClass="mnemonic-transform-content"
        wrapperStyle={{ width: '100%', height: '100%' }}
        contentStyle={{ width: 1600, height: 760 }}
      >
        <svg
          className="mnemonic-svg"
          viewBox="0 0 1600 760"
          width="1600"
          height="760"
          onClick={onBackgroundClick}
          role="img"
          aria-label="Общая технологическая цепочка: нефть, АВТ, гидроочистка, блендинг и товарный резервуар"
        >
          <defs>
            <marker id="process-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
              <path d="M0,0 L0,9 L9,4.5 z" />
            </marker>
          </defs>

          <g className="process-flow-layer">
            <path className="process-flow" d="M270 365 H375 M655 365 H765 M1045 365 H1145 M1425 365 H1490 V505" />
            <text className="process-flow-label" x="708" y="331">Прямогонная</text>
            <text className="process-flow-label" x="708" y="350">дизельная фракция</text>
            <text className="process-flow-label" x="1088" y="331">Очищенный</text>
            <text className="process-flow-label" x="1088" y="350">дизельный компонент</text>
            <text className="process-flow-label process-flow-label--product" x="1457" y="320">Товарный дизель</text>
            <text className="process-flow-label process-flow-label--product" x="1457" y="339">(смесь)</text>
            {influence !== 'off' && <path className="process-influence" d={influencePaths[influence]} />}
          </g>

          <Stage x={65} y={285} width={205} height={160} title="Нефть" lines={['Сырьё АВТ']} tone="crude" Icon={IconGasStation} />
          <Stage x={375} y={265} width={280} height={205} title="АВТ" lines={['Температура печи', 'Расход колонны', 'Сера сырья']} tone="process" Icon={IconBuildingFactory2} />
          <Stage x={765} y={265} width={280} height={205} title="Гидроочистка" lines={['Температура входа', 'Расход продукта', 'Давление реактора']} tone="process" Icon={IconFlask} />
          <Stage x={1145} y={265} width={280} height={205} title="Блендинг" lines={['Доли компонентов', 'Дозировка присадок']} tone="process" Icon={IconStack2} />
          <Stage x={1380} y={505} width={190} height={175} title="Товарный резервуар" lines={['Контроль качества', 'Сера ≤ 10 мг/кг', 'T95 ≤ 360 °C', 'Цетановое число ≥ 51']} tone="product" Icon={IconDroplet} />

          <Marker x={405} y={220} variant="managed">Y</Marker><text className="process-marker-label" x="434" y="214">T печи, P колонны</text>
          <Marker x={405} y={513} variant="lab">ЛК</Marker><text className="process-marker-label" x="434" y="518">Качество дизеля</text>
          <Marker x={795} y={220} variant="managed">Y</Marker><text className="process-marker-label" x="824" y="214">T, P, расходы</text>
          <Marker x={795} y={513} variant="lab">ЛК</Marker><text className="process-marker-label" x="824" y="518">Сера на входе / выходе</text>
          <Marker x={1175} y={220} variant="managed">Y</Marker><text className="process-marker-label" x="1204" y="214">Управление долями, дозировка</text>
          <Marker x={1175} y={513} variant="lab">ЛК</Marker><text className="process-marker-label" x="1204" y="518">Все показатели</text>

          {sensors.map((sensor) => {
            const point = latest.get(sensor.tag);
            const visualState = getState(point);
            const active = selected === sensor.tag;
            const label = `${sensor.label}: ${point?.value == null ? 'нет данных' : `${format(point.value)} ${point.unit ?? ''}`} · ${stateLabels[visualState]}`;
            return <g className="sensor-hit" key={sensor.tag} role="button" aria-label={label} aria-pressed={active} tabIndex={0} onClick={(event) => { event.stopPropagation(); onSelect(sensor.tag); }} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(sensor.tag);
              }
            }}>
              <title>{label}</title>
              <circle className="sensor-hit-area" cx={sensor.x} cy={sensor.y} r="21" />
              {sensor.lab
                ? <rect className={`sensor-dot ${visualState} ${active ? 'selected' : ''}`} x={sensor.x - 10} y={sensor.y - 10} width="20" height="20" rx="4" />
                : <circle className={`sensor-dot ${visualState} ${sensor.managed ? 'managed' : ''} ${active ? 'selected' : ''}`} cx={sensor.x} cy={sensor.y} r="10" />}
              <text className="sensor-text" x={sensor.x} y={sensor.y - 18}>{sensor.label}{sensor.managed ? ' Y' : ''}</text>
            </g>;
          })}
        </svg>
      </TransformComponent>
    </>}
  </TransformWrapper>;
}
