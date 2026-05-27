import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

function formatName(name) {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function iconFor(check) {
  if (check.pass) return <CheckCircle2 size={18} />;
  if (check.severity === 'error') return <XCircle size={18} />;
  return <AlertTriangle size={18} />;
}

export default function VerificationPanel({ report }) {
  const checks = Object.entries(report?.checks || {});
  const nodes = Object.entries(report?.node_voltages || {});
  const branches = Object.entries(report?.branch_currents || {});

  return (
    <section className="panel-section verification-section">
      <div className="section-title-row">
        <h2>Verification</h2>
        <span className={report?.status || 'idle'}>{report?.status || 'waiting'}</span>
      </div>

      <div className="check-list">
        {checks.length === 0 && <div className="empty-state">Simulation results will appear here.</div>}
        {checks.map(([name, check]) => (
          <div key={name} className={`check-card ${check.pass ? 'pass' : check.severity}`}>
            <div className="check-icon">{iconFor(check)}</div>
            <div>
              <strong>{formatName(name)}</strong>
              <p>
                {check.value !== null && check.value !== undefined ? `${check.value}${check.unit ? ` ${check.unit}` : ''} — ` : ''}
                {check.message}
              </p>
            </div>
          </div>
        ))}
      </div>

      {(nodes.length > 0 || branches.length > 0) && (
        <div className="measurement-grid">
          <div>
            <h3>Node Voltages</h3>
            {nodes.slice(0, 8).map(([node, value]) => (
              <p key={node}>
                <span>{node}</span>
                <strong>{Number(value).toFixed(2)} V</strong>
              </p>
            ))}
          </div>
          <div>
            <h3>Branch Currents</h3>
            {branches.slice(0, 8).map(([branch, value]) => (
              <p key={branch}>
                <span>{branch}</span>
                <strong>{(Math.abs(Number(value)) * 1000).toFixed(2)} mA</strong>
              </p>
            ))}
          </div>
        </div>
      )}

      {report?.raw_output && <pre className="raw-output">{report.raw_output}</pre>}
    </section>
  );
}
