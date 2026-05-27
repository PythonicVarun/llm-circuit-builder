# ⚙️ Circuit Builder Backend

The backend service for the Circuit Builder application, providing an AI agent that generates and verifies electronic circuits from natural language prompts. 🧠🔌

## 🛠️ Technology Stack

- 🚀 **Framework**: FastAPI
- 🤖 **AI Agent**: LangGraph, LangChain (Anthropic Claude 3.5 Sonnet)
- ⚡ **Simulation**: PySpice / Ngspice
- ✅ **Data Validation**: Pydantic

## 🧩 Key Components

- 📜 `agent/circuit_agent.py`: The core LangGraph state machine orchestrating intent parsing, netlist generation, verification, and visualization config building.
- 🏗️ `agent/netlist_generator.py`: Generates SPICE netlists, CircuitJS text formats, and Wokwi breadboard configurations based on the AI's structural output.
- 🔍 `agent/verifier.py`: Uses PySpice to run operating-point simulations on the generated SPICE netlists, determining branch currents and checking for electrical issues like missing resistors.
- 🚪 `main.py`: The FastAPI entry point exposing REST endpoints and a WebSocket for real-time progress streaming.

## 🌐 API Endpoints

- 📝 `POST /api/circuit/generate` - Generate a circuit synchronously.
- 📚 `GET /api/circuit/examples` - Retrieve a list of example prompts.
- ✅ `POST /api/circuit/verify` - Verify a raw SPICE netlist.
- 📡 `WS /ws/agent-stream` - WebSocket for streaming circuit generation progress.

## 💻 Local Development (Without Docker)

1. Ensure Python 3.12+ and `uv` are installed. 🐍
2. Install dependencies:
   ```bash
   uv pip install -r requirements.txt
   ```
3. Install Ngspice 🌶️ (e.g., `apt-get install ngspice` on Debian/Ubuntu, or `brew install ngspice` on macOS).
4. Run the server:
   ```bash
   fastapi dev main.py --host 0.0.0.0 --port 8000
   ```