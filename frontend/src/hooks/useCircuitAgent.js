import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

const emptySteps = [
  { step: 'Parsing', status: 'pending', message: '' },
  { step: 'Generating Netlist', status: 'pending', message: '' },
  { step: 'Simulating', status: 'pending', message: '' },
  { step: 'Rendering', status: 'pending', message: '' },
];

function mergeStep(current, incoming) {
  return current.map((item) => (item.step === incoming.step ? { ...item, ...incoming } : item));
}

function normalizeSteps(agentSteps = []) {
  return agentSteps.reduce((current, step) => mergeStep(current, step), emptySteps);
}

function readErrorDetail(err) {
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') {
    return { message: detail, step: 'Generating Netlist' };
  }
  if (detail && typeof detail === 'object') {
    return {
      message: detail.message || 'Circuit generation failed',
      step: detail.step || 'Generating Netlist',
    };
  }
  return { message: err.message || 'Circuit generation failed', step: 'Generating Netlist' };
}

export function useCircuitAgent() {
  const [result, setResult] = useState(null);
  const [examples, setExamples] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [steps, setSteps] = useState(emptySteps);
  const wsRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/agent-stream`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'agent_step') {
        setSteps((current) => mergeStep(current, payload.step));
      }
      if (payload.type === 'result') {
        setResult(payload.result);
        setError('');
        setLoading(false);
      }
      if (payload.type === 'error') {
        const message = payload.error?.message || 'Circuit generation failed';
        const step = payload.error?.step || 'Generating Netlist';
        setResult(null);
        setError(message);
        setSteps((current) => mergeStep(current, { step, status: 'error', message }));
        setLoading(false);
      }
    };
    ws.onerror = () => {
      ws.close();
    };
    return () => ws.close();
  }, []);

  const fetchExamples = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/circuit/examples`);
      setExamples(response.data);
    } catch {
      setExamples([]);
    }
  }, []);

  const generateCircuit = useCallback(async (prompt) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    setResult(null);
    setSteps(emptySteps);
    try {
      const response = await axios.post(`${API_BASE}/api/circuit/generate`, { prompt: trimmed });
      setResult(response.data);
      setSteps(response.data.agent_steps?.length ? normalizeSteps(response.data.agent_steps) : emptySteps);
    } catch (err) {
      const { message, step } = readErrorDetail(err);
      setResult(null);
      setError(message);
      setSteps((current) => mergeStep(current, { step, status: 'error', message }));
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    result,
    examples,
    loading,
    error,
    steps,
    fetchExamples,
    generateCircuit,
  };
}
