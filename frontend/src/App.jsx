import React from 'react';
import { useEffect, useState } from 'react';

import CircuitCanvas from './components/CircuitCanvas.jsx';
import ComponentList from './components/ComponentList.jsx';
import PromptBar from './components/PromptBar.jsx';
import StatusBar from './components/StatusBar.jsx';
import VerificationPanel from './components/VerificationPanel.jsx';
import { useCircuitAgent } from './hooks/useCircuitAgent.js';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const { result, examples, loading, error, steps, generateCircuit, fetchExamples } = useCircuitAgent();
  const status = error ? 'error' : result?.verification?.status || 'idle';
  const statusLabel = error ? 'error' : result?.verification?.status || 'ready';

  useEffect(() => {
    fetchExamples();
  }, [fetchExamples]);

  const handleExample = (examplePrompt) => {
    setPrompt(examplePrompt);
    generateCircuit(examplePrompt);
  };

  return (
    <main className="app-shell">
      <section className="left-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Circuit Agent</p>
            <h1>Live Circuit Builder</h1>
          </div>
          <div className={`status-pill ${status}`}>
            {statusLabel}
          </div>
        </div>

        <PromptBar
          prompt={prompt}
          setPrompt={setPrompt}
          onGenerate={() => generateCircuit(prompt)}
          loading={loading}
          examples={examples}
          onExample={handleExample}
        />

        <StatusBar steps={steps} loading={loading} error={error} />

        <div className="left-scroll">
          <ComponentList intent={result?.intent} />
          <VerificationPanel report={result?.verification} />
        </div>
      </section>

      <section className="right-panel">
        <CircuitCanvas result={result} loading={loading} error={error} />
      </section>
    </main>
  );
}
