# Circuit Builder

Full-stack circuit agent app with a FastAPI backend, React/Vite frontend, self-hosted animated circuit viewer, Wokwi Elements breadboard view, and electrical verification.

## Run

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000`.

The backend works without an Anthropic key by using deterministic safe generation for the included example circuits. Set `ANTHROPIC_API_KEY` to enable Claude-assisted intent parsing.

## API

- `POST /api/circuit/generate` with `{ "prompt": "Christmas tree with 5 LEDs" }`
- `GET /api/circuit/examples`
- `POST /api/circuit/verify` with `{ "spice_netlist": "..." }`
- `WS /ws/agent-stream`

## Notes

- LED circuits always receive current-limiting resistors before simulation.
- PySpice/Ngspice is attempted first for operating-point simulation. If unavailable or unable to parse a netlist, the backend returns a graceful deterministic verification report with raw error context.
- `frontend/public/circuitjs/index.html` is self-hosted and accepts CircuitJS-style text through `postMessage({ type: "loadCircuit", circuit })`.
