# 🔌 Circuit Builder

A full-stack AI-powered circuit design agent that takes natural language prompts and generates, verifies, and visualizes electronic circuits. The application features a FastAPI backend orchestrating an Anthropic-powered LangGraph agent, and a React/Vite frontend providing interactive breadboard and schematic visualizations. 🤖✨

## ✨ Features

- 🧠 **AI Circuit Generation**: Uses Claude (via Anthropic) to interpret user intents and generate complete circuit topologies.
- ⚡ **Circuit Verification**: Validates generated circuits using PySpice/Ngspice for operating-point simulation, verifying current flows, LED brightness, and component safety (e.g., missing current-limiting resistors).
- 🎨 **Interactive Visualizations**:
  - 🍞 Wokwi Elements for realistic breadboard views with interactive component states (e.g., dynamic LED brightness, buzzer activation).
  - 📊 CircuitJS integration for animated schematic simulation.
- 🚀 **Real-time Streaming**: WebSocket-based progress updates during the multi-step circuit generation process.

## 🏗️ Architecture

- 🐍 **Backend**: Python, FastAPI, LangGraph, LangChain, PySpice/Ngspice.
- ⚛️ **Frontend**: React, Vite, Zustand, TailwindCSS, Wokwi Elements.

## 🚀 Getting Started

### 📋 Prerequisites
- 🐳 Docker and Docker Compose
- 🔑 Anthropic API Key (Optional for included examples, required for novel circuit generation)

### 🏃‍♂️ Running the Application

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. (Optional) Add your `ANTHROPIC_API_KEY` to the `.env` file to enable custom AI generation.
3. Start the services using Docker Compose:
   ```bash
   docker compose up --build
   ```
4. Access the web interface at `http://localhost:3000` 🌐.

## 📝 Notes

- 💡 LED circuits always receive current-limiting resistors before simulation.
- 🛠️ PySpice/Ngspice is attempted first for operating-point simulation. If unavailable or unable to parse a netlist, the backend returns a graceful deterministic verification report with raw error context.
- 📂 `frontend/public/circuitjs/index.html` is self-hosted and accepts CircuitJS-style text through `postMessage({ type: "loadCircuit", circuit })`.

## 📁 Project Structure

- ⚙️ `/backend` - FastAPI application and LangGraph AI agent. See [Backend README](backend/README.md).
- 💻 `/frontend` - React/Vite web interface. See [Frontend README](frontend/README.md).

## 📄 License

This project is licensed under the [MIT License](LICENSE). ⚖️