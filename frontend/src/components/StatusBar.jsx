import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';

function StepIcon({ status }) {
  if (status === 'complete') return <CheckCircle2 size={16} />;
  if (status === 'active') return <Loader2 className="spin" size={16} />;
  if (status === 'error') return <AlertTriangle size={16} />;
  return <Circle size={16} />;
}

export default function StatusBar({ steps, loading, error }) {
  return (
    <section className="status-strip" aria-live="polite">
      {steps.map((step) => (
        <div key={step.step} className={`step-item ${step.status}`}>
          <StepIcon status={step.status} />
          <span>{step.step}</span>
        </div>
      ))}
      {error && <div className="inline-error">{error}</div>}
      {!loading && !error && <div className="inline-hint">Agent stream connected</div>}
    </section>
  );
}
