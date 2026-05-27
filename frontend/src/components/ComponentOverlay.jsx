import '@wokwi/elements';

import { useSimulation } from '../hooks/useSimulation.js';

const WIRE_LAYER_WIDTH = 880;
const WIRE_LAYER_HEIGHT = 620;

function Breadboard() {
  const rows = [];
  const holesPerStrip = 30;
  const stripGap = 18;
  const holeSize = 7;
  const railY1 = 24;
  const railY2 = WIRE_LAYER_HEIGHT - 64;
  const topBoardY = 70;
  const bottomBoardY = WIRE_LAYER_HEIGHT - 200;

  // Power rails (top + bottom)
  for (let row = 0; row < 2; row += 1) {
    const yBase = row === 0 ? railY1 : railY2;
    for (let strip = 0; strip < 2; strip += 1) {
      const y = yBase + strip * 18;
      for (let col = 0; col < holesPerStrip; col += 1) {
        const x = 40 + col * 24;
        rows.push(
          <rect
            key={`rail-${row}-${strip}-${col}`}
            x={x}
            y={y}
            width={holeSize}
            height={holeSize}
            rx={1.5}
            className="bb-hole"
          />,
        );
      }
    }
  }

  // Tie-point rows: top half (rows a-e) + bottom half (rows f-j)
  for (let section = 0; section < 2; section += 1) {
    const yStart = section === 0 ? topBoardY : bottomBoardY;
    for (let line = 0; line < 5; line += 1) {
      for (let col = 0; col < holesPerStrip; col += 1) {
        const x = 40 + col * 24;
        const y = yStart + line * stripGap;
        rows.push(
          <rect
            key={`tie-${section}-${line}-${col}`}
            x={x}
            y={y}
            width={holeSize}
            height={holeSize}
            rx={1.5}
            className="bb-hole"
          />,
        );
      }
    }
  }

  return (
    <svg
      className="breadboard-bg"
      viewBox={`0 0 ${WIRE_LAYER_WIDTH} ${WIRE_LAYER_HEIGHT}`}
      aria-hidden="true"
    >
      <rect
        x={16}
        y={8}
        width={WIRE_LAYER_WIDTH - 32}
        height={WIRE_LAYER_HEIGHT - 16}
        rx={14}
        className="bb-body"
      />
      <line
        x1={28}
        y1={railY1 + 28}
        x2={WIRE_LAYER_WIDTH - 28}
        y2={railY1 + 28}
        className="bb-rail-line rail-red"
      />
      <line
        x1={28}
        y1={railY1 + 8}
        x2={WIRE_LAYER_WIDTH - 28}
        y2={railY1 + 8}
        className="bb-rail-line rail-blue"
      />
      <line
        x1={28}
        y1={railY2 + 28}
        x2={WIRE_LAYER_WIDTH - 28}
        y2={railY2 + 28}
        className="bb-rail-line rail-red"
      />
      <line
        x1={28}
        y1={railY2 + 8}
        x2={WIRE_LAYER_WIDTH - 28}
        y2={railY2 + 8}
        className="bb-rail-line rail-blue"
      />
      <rect
        x={16}
        y={WIRE_LAYER_HEIGHT / 2 - 14}
        width={WIRE_LAYER_WIDTH - 32}
        height={28}
        className="bb-channel"
      />
      {rows}
    </svg>
  );
}

function CustomPart({ part }) {
  if (part.type === 'capacitor') {
    return (
      <div className="custom-part capacitor">
        <span className="cap-plate" />
        <span className="cap-plate" />
        <strong>{part.attrs?.value || '10µF'}</strong>
      </div>
    );
  }
  if (part.type === 'ic-555') {
    return (
      <div className="custom-part ic">
        <span className="ic-notch" />
        <span className="ic-label">{part.attrs?.label || '555'}</span>
        <div className="ic-pins left">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={`l${i}`} className="ic-pin" />
          ))}
        </div>
        <div className="ic-pins right">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={`r${i}`} className="ic-pin" />
          ))}
        </div>
      </div>
    );
  }
  if (part.type === 'wokwi-battery') {
    return (
      <div className="custom-part battery">
        <span className="battery-pos">+</span>
        <span className="battery-body">{part.attrs?.voltage || '9'}V</span>
        <span className="battery-neg">−</span>
      </div>
    );
  }
  if (part.type === 'wokwi-npn-transistor') {
    return (
      <div className="custom-part transistor">
        <span className="trans-body">NPN</span>
        <span className="trans-lead lead-c" />
        <span className="trans-lead lead-b" />
        <span className="trans-lead lead-e" />
      </div>
    );
  }
  return <div className="part-fallback">{part.id}</div>;
}

function WokwiPart({ part, state, onToggle }) {
  const attrs = part.attrs || {};
  const style = {
    position: 'absolute',
    top: `${part.top}px`,
    left: `${part.left}px`,
    filter:
      state?.on && state?.color
        ? `drop-shadow(0 0 ${8 + 18 * (state.brightness || 0)}px ${state.color})`
        : undefined,
    opacity: state?.on === false && part.type.includes('led') ? 0.45 : 1,
  };
  const value = part.type.includes('led')
    ? state?.on
      ? String(Math.max(0.15, state.brightness || 1))
      : '0'
    : state?.closed === false
      ? '0'
      : '1';

  const wokwiTypes = [
    'wokwi-led',
    'wokwi-resistor',
    'wokwi-slide-switch',
    'wokwi-buzzer',
  ];

  return (
    <div
      className="wokwi-part"
      style={style}
      onClick={part.type.includes('switch') ? () => onToggle(part.id) : undefined}
    >
      {part.type.includes('switch') && (
        <span className={`switch-glow ${state?.closed === false ? 'open' : 'closed'}`} />
      )}
      {part.type.includes('buzzer') && state?.on && <span className="sound-ring" />}
      {part.type === 'wokwi-led' && <wokwi-led color={attrs.color || 'red'} value={value} />}
      {part.type === 'wokwi-resistor' && <wokwi-resistor value={attrs.value || '330'} />}
      {part.type === 'wokwi-slide-switch' && <wokwi-slide-switch value={value} />}
      {part.type === 'wokwi-buzzer' && <wokwi-buzzer value={state?.on ? '1' : '0'} />}
      {!wokwiTypes.includes(part.type) && <CustomPart part={part} />}
      {state?.current_ma !== undefined && <em>{state.current_ma} mA</em>}
    </div>
  );
}

function partAnchor(part) {
  // Anchor point used when drawing wires between parts.
  const offsets = {
    'wokwi-battery': [28, 36],
    'wokwi-resistor': [36, 14],
    'wokwi-led': [22, 30],
    'wokwi-slide-switch': [32, 22],
    'wokwi-buzzer': [32, 32],
    'wokwi-npn-transistor': [22, 30],
    'ic-555': [60, 50],
    capacitor: [30, 24],
  };
  const [dx, dy] = offsets[part.type] || [42, 26];
  return [part.left + dx, part.top + dy];
}

export default function ComponentOverlay({ result }) {
  const diagram = result?.visualization_config?.wokwi_diagram;
  const { states, toggleSwitch } = useSimulation(result);

  if (!diagram) {
    return <div className="empty-canvas">Generate a circuit to inspect the physical components.</div>;
  }

  return (
    <div className="breadboard-view">
      <Breadboard />
      <svg className="wire-layer" viewBox={`0 0 ${WIRE_LAYER_WIDTH} ${WIRE_LAYER_HEIGHT}`} aria-hidden="true">
        {diagram.connections.map((connection, index) => {
          const [from, to, color] = connection;
          const source = diagram.parts.find((part) => from.startsWith(`${part.id}:`));
          const target = diagram.parts.find((part) => to.startsWith(`${part.id}:`));
          if (!source || !target) return null;
          const [x1, y1] = partAnchor(source);
          const [x2, y2] = partAnchor(target);
          const strokeColor =
            color === 'black'
              ? '#1f2937'
              : color === 'purple'
                ? '#c084fc'
                : color === 'yellow'
                  ? '#facc15'
                  : color === 'green'
                    ? '#22c55e'
                    : color;
          return (
            <path
              key={`${from}-${to}-${index}`}
              d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
              stroke={strokeColor}
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {diagram.parts.map((part) => (
        <WokwiPart key={part.id} part={part} state={states[part.id]} onToggle={toggleSwitch} />
      ))}
    </div>
  );
}
