import { useMemo, useState } from 'react';

export function useSimulation(result) {
  const [switches, setSwitches] = useState({});

  const states = useMemo(() => {
    const source = result?.visualization_config?.component_states || {};
    const next = JSON.parse(JSON.stringify(source));
    Object.entries(switches).forEach(([id, closed]) => {
      if (next[id]) {
        next[id].closed = closed;
      }
      if (!closed) {
        Object.entries(next).forEach(([stateId, state]) => {
          if (stateId.startsWith('led') || stateId.startsWith('buzzer')) {
            state.on = false;
            state.sound = false;
            state.brightness = 0;
          }
        });
      }
    });
    return next;
  }, [result, switches]);

  const toggleSwitch = (id) => {
    setSwitches((current) => {
      const previous = current[id] ?? result?.visualization_config?.component_states?.[id]?.closed ?? true;
      return { ...current, [id]: !previous };
    });
  };

  return { states, switches, toggleSwitch };
}
