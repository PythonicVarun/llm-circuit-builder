import { Blocks, Cpu, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import ComponentOverlay from './ComponentOverlay.jsx';

const tabs = [
  { id: 'animated', label: 'Animated', icon: Cpu },
  { id: 'schematic', label: 'Schematic', icon: FileText },
  { id: 'breadboard', label: 'Breadboard', icon: Blocks },
];

export default function CircuitCanvas({ result, loading, error }) {
  const [activeTab, setActiveTab] = useState('animated');
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!result?.circuitjs_text || !iframeRef.current) return;
    const sendCircuit = () => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: 'loadCircuit',
          circuit: result.circuitjs_text,
        },
        '*',
      );
    };
    sendCircuit();
    const timer = setTimeout(sendCircuit, 300);
    return () => clearTimeout(timer);
  }, [result?.circuitjs_text, activeTab]);

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar">
        <div>
          <p className="eyebrow">Interactive Canvas</p>
          <h2>{result?.intent?.circuit_name || 'Awaiting circuit'}</h2>
        </div>
        <div className="tab-list" role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="canvas-stage">
        {activeTab === 'animated' && result?.circuitjs_text && !error && (
          <iframe
            ref={iframeRef}
            id="circuit-iframe"
            title="CircuitJS1 visualization"
            src="/circuitjs/index.html"
            sandbox="allow-scripts allow-same-origin"
          />
        )}
        {activeTab === 'animated' && !result?.circuitjs_text && !error && (
          <div className="empty-canvas">Generate a circuit to start the live simulation.</div>
        )}

        {activeTab === 'schematic' && (
          <div
            className="schematic-view"
            dangerouslySetInnerHTML={{
              __html: result?.schematic_svg || '<div class="empty-canvas">Generate a circuit to view the schematic.</div>',
            }}
          />
        )}

        {activeTab === 'breadboard' && <ComponentOverlay result={result} />}

        {error && (
          <div className="canvas-error" role="alert">
            <strong>Generation stopped</strong>
            <p>{error}</p>
          </div>
        )}
        {loading && <div className="canvas-loading">Generating circuit...</div>}
      </div>
    </div>
  );
}
