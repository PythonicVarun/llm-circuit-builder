import { Loader2, Play, Sparkles } from 'lucide-react';

export default function PromptBar({ prompt, setPrompt, onGenerate, loading, examples, onExample }) {
  return (
    <section className="prompt-block">
      <div className="prompt-input-wrap">
        <Sparkles size={18} aria-hidden="true" />
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe your circuit... e.g. 'Christmas tree with 5 LEDs and a 9V battery'"
          rows={4}
        />
      </div>
      <button className="primary-button" onClick={onGenerate} disabled={loading}>
        {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
        <span>{loading ? 'Generating' : 'Generate Circuit'}</span>
      </button>

      <div className="example-grid">
        {examples.map((example) => (
          <button key={example.title} className="example-chip" onClick={() => onExample(example.prompt)} disabled={loading}>
            {example.title}
          </button>
        ))}
      </div>
    </section>
  );
}
