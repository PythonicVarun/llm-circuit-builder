import { BatteryCharging, Bell, Cpu, Lightbulb, RadioTower, Sigma, Zap } from 'lucide-react';

const iconMap = {
  led: Lightbulb,
  resistor: Sigma,
  battery: BatteryCharging,
  buzzer: Bell,
  '555 timer': RadioTower,
  'npn transistor': Cpu,
};

function componentIcon(type) {
  const Icon = iconMap[type.toLowerCase()] || Zap;
  return <Icon size={17} aria-hidden="true" />;
}

export default function ComponentList({ intent }) {
  const components = intent?.components || [];
  return (
    <section className="panel-section">
      <div className="section-title-row">
        <h2>Components</h2>
        <span>{components.length ? intent.topology : 'empty'}</span>
      </div>

      <div className="component-list">
        {components.length === 0 && <div className="empty-state">No circuit generated yet.</div>}
        {components.map((component, index) => (
          <div className="component-row" key={`${component.type}-${index}`}>
            <div className="component-icon">{componentIcon(component.type)}</div>
            <div>
              <strong>{component.type}</strong>
              <p>
                {component.count}x
                {component.color ? ` · ${component.color}` : ''}
                {component.value_ohm ? ` · ${component.value_ohm}Ω` : ''}
                {component.voltage ? ` · ${component.voltage}V` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
