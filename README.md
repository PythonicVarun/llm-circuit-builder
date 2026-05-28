# 🔌 Circuit Lab - LLM × Wokwi 🤖

A purely-browser playground 🌐 that lets any OpenAI-compatible LLM 🧠 generate **complete Wokwi simulation projects** 🛠️ (diagram.json, firmware/source, supporting files) from natural-language prompts 💬, and runs them live in an embedded Wokwi simulator ⚡.

The LLM is fully user-supplied 🧑‍💻: you provide a base URL, API key 🔑, and model id - works with OpenAI, OpenRouter, Groq, Ollama, vLLM, LM Studio, Together, DeepInfra, Fireworks, and anything else that speaks `/chat/completions` 🗣️.

## 🚀 Run

It's a static site - no build step 🙃.

```bash
git clone https://github.com/PythonicVarun/llm-circuit-builder.git
cd llm-circuit-builder
python3 -m http.server 8000
# open http://localhost:8000
```

Or with any static server (`npx serve .`, `caddy file-server`, etc.) 💻.

> ⚠️ Open over `http://localhost` (not `file://`), otherwise the Wokwi iframe can't `postMessage` back 🛑.

## ⚙️ How it works

1. The Wokwi iframe 🖼️ (`wokwi.com/experimental/embed`) posts a `MessagePort` 🚪 to the parent on load.
2. We wrap that port in `WokwiClient` 📦 (the protocol from [wokwi/wokwi-embed-example](https://github.com/wokwi/wokwi-embed-example)).
3. The LLM 🧠 is instructed to reply with a fenced ```` ```wokwi-project ```` JSON block 🧱:
   ```json
   {
     "explanation": "…",
     "files": { "diagram.json": "…", "sketch.ino": "…" },
     "start":  { "firmware": "sketch.ino", "elf": "sketch.ino" }
   }
   ```
4. Each file is uploaded via `file:upload` 📤, then `sim:start` 🎬 kicks off the simulation.
5. Serial output is streamed back into the on-page monitor 📺.

## 🛠️ Configure the LLM

Click **Settings** ⚙️ in the top right. Fields:

| Field        | Example                                    |
|--------------|--------------------------------------------|
| 🔗 API base URL | `https://api.openai.com/v1`                |
| 🔑 API key      | `sk-…`                                     |
| 🤖 Model ID     | `gpt-4o-mini`                              |

Presets are included for OpenAI, OpenRouter, Groq, and Ollama 🎛️. Values are stored in `localStorage` only 🔒 - nothing leaves your browser except the chat-completion calls themselves 🛡️.

## 📁 Files

- 📄 `index.html` - layout
- 🎨 `styles.css` - phosphor-on-slate UI
- 🧠 `app.js`     - orchestrator (LLM ↔ Wokwi ↔ DOM)
- 🤖 `llm.js`     - OpenAI-compatible streaming client + system prompt
- 🔌 `wokwi-client.js`, `message-port-transport.js`, `base64.js` - Wokwi embed protocol (MIT, CodeMagic LTD)

## 🙏 Credits

Wokwi embed protocol from <https://github.com/wokwi/wokwi-embed-example> (MIT, © 2025 CodeMagic LTD) ✨.

## 📜 License

This project is licensed under the [MIT License](LICENSE). ⚖️
