# 💻 Circuit Builder Frontend

The interactive web interface for the Circuit Builder application, allowing users to prompt the AI agent and visualize generated circuits. ✨🎨

## 🛠️ Technology Stack

- ⚛️ **Framework**: React 18, Vite
- 📦 **State Management**: Zustand
- 💅 **Styling**: Tailwind CSS, PostCSS
- 🖼️ **Circuit Visualization**: Wokwi Elements, CircuitJS, SchemDraw (via SVG)
- 🌟 **Icons**: Lucide React

## ✨ Key Features

- 💬 **Prompt Interface**: Submit natural language requests for new circuits or choose from predefined examples.
- ⏳ **Real-time Status**: View step-by-step progress of the AI agent via WebSocket streaming.
- 📋 **Component List**: Displays the extracted components and overall circuit intent identified by the AI.
- 🍞 **Interactive Breadboard**: Renders the circuit on a breadboard using Wokwi Elements. Component states (like LED brightness and color, or buzzer sound) are dynamically animated based on backend simulation results.
- 📊 **Animated Schematic**: Embeds CircuitJS via `postMessage` for an interactive, animated view of the generated netlist.
- ✅ **Verification Panel**: Shows the results of the electrical simulation, highlighting potential issues or confirming successful operation.

## 👨‍💻 Local Development (Without Docker)

1. Ensure Node.js 20+ is installed. 🟢
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Access the UI at `http://localhost:3000` 🌐.