// OpenAI-compatible chat client with streaming + JSON-block extraction.

export const SYSTEM_PROMPT = `You are a circuit-simulation copilot. The user describes a circuit or microcontroller demo in natural language; you respond with a complete Wokwi simulation project that runs in the browser.

YOU MUST RETURN EXACTLY ONE FENCED CODE BLOCK with language tag \`wokwi-project\` containing strict JSON of this shape:

\`\`\`wokwi-project
{
  "explanation": "1-3 short sentences describing what the circuit does and any wiring notes",
  "files": {
    "diagram.json": "<stringified JSON for Wokwi diagram>",
    "sketch.ino": "<source code if Arduino>",
    "main.py":   "<source code if MicroPython>",
    "...": "any other source/data files the sim needs"
  },
  "start": { "firmware": "<filename>", "elf": "<filename>" }
}
\`\`\`

Outside that block, write only a brief human-readable preface (one or two lines). Do not wrap the JSON in extra commentary. The JSON must parse with JSON.parse - all file contents are JSON strings (escape newlines/quotes).

WOKWI ESSENTIALS
- diagram.json schema: { "version": 1, "author": "...", "editor": "wokwi", "parts": [...], "connections": [...], "dependencies": {} }
- Each part: { "type": "<wokwi-part-type>", "id": "<unique>", "top": Y, "left": X, "attrs": {...}, "rotate": optional }
- A connection is an array: [ "partId:pin", "otherPartId:pin", "color", [pathPoints] ]. Path points can be []. Colors: "red","black","green","blue","yellow","orange","purple","white","gray".
- For serial output add: [ "mcu:TX", "$serialMonitor:RX", "", [] ] and [ "mcu:RX", "$serialMonitor:TX", "", [] ].

COMMON BOARDS (pick what fits the user's request):
- "wokwi-arduino-uno"           id e.g. "uno"  (Arduino UNO; pins like uno:13, uno:GND, uno:5V, uno:A0)
- "wokwi-arduino-mega"
- "wokwi-arduino-nano"
- "board-esp32-devkit-c-v4"     attrs.env e.g. "micropython-20231227-v1.22.0" for MicroPython
- "board-pi-pico"               (use sketch.ino with arduino-pico, or micropython main.py)
- "wokwi-attiny85"

COMMON PARTS:
- "wokwi-led"        attrs: { color:"red"|"green"|"blue"|"yellow"|"white", flip:"" }   pins: A (anode), C (cathode)
- "wokwi-resistor"   attrs: { value: "220" }                                            pins: 1, 2
- "wokwi-pushbutton" attrs: { color:"red" }                                             pins: 1.l, 1.r, 2.l, 2.r
- "wokwi-breadboard-half" or "wokwi-breadboard"
- "wokwi-potentiometer"  pins: SIG, VCC, GND
- "wokwi-buzzer"         pins: 1, 2
- "wokwi-servo"          pins: PWM, V+, GND
- "wokwi-hc-sr04"        ultrasonic; pins: VCC, GND, TRIG, ECHO
- "wokwi-dht22"          pins: VCC, SDA, NC, GND
- "wokwi-ssd1306"        I2C OLED; pins: VCC, GND, SCL, SDA
- "wokwi-lcd1602"        pins: VSS, VDD, V0, RS, RW, E, D0..D7, A, K
- "wokwi-7segment"
- "wokwi-neopixel-ring" attrs: { pixels: 16 }  pins: VCC, GND, DIN, DOUT
- "wokwi-slide-switch", "wokwi-dip-switch-8"

DEFAULTS for sim:start params:
- AVR Arduino (UNO/Mega/Nano/ATtiny): { "firmware": "sketch.ino", "elf": "sketch.ino" }
  (the host page auto-compiles .ino to .hex via hexi.wokwi.com before starting)
- ESP32 Arduino:    { "firmware": "sketch.ino", "elf": "sketch.ino" }  (compiled in-browser)
- Pi Pico Arduino:  { "firmware": "sketch.ino", "elf": "sketch.ino" }  (compiled in-browser)
- MicroPython:      { "firmware": "main.py",    "elf": "main.py" }     (no compile needed)

RULES
- Always include current-limiting resistors with LEDs (typ. 220-330 ohm).
- Always wire ground and power explicitly.
- Always include the serial monitor wiring when the code prints anything.
- Keep components positioned without overlap; spread parts across a reasonable area (left 0-400, top 0-300).
- Prefer the simplest board that fulfills the request.
- If the user asks for something ambiguous, choose sensible defaults and mention them in "explanation".
- Never include markdown inside file contents. Code is raw source. diagram.json is raw stringified JSON.`;

export class LLMClient {
    constructor({ baseUrl, apiKey, model }) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
        this.model = model;
    }

    async *stream(messages, { signal } = {}) {
        const url = `${this.baseUrl}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
                stream: true,
                temperature: 0.4,
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (data === '[DONE]') return;
                try {
                    const obj = JSON.parse(data);
                    const delta = obj.choices?.[0]?.delta?.content ?? '';
                    if (delta) yield delta;
                } catch { /* ignore keepalive / parse errors */ }
            }
        }
    }
}

// Extract the wokwi-project JSON block from the assistant message.
export function extractProject(text) {
    const m = text.match(/```wokwi-project\s*([\s\S]*?)```/i)
        || text.match(/```json\s*([\s\S]*?)```/i)
        || text.match(/```\s*(\{[\s\S]*?\})\s*```/);
    const raw = m ? m[1].trim() : null;
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        if (obj && obj.files && typeof obj.files === 'object') return obj;
    } catch (e) {
        console.warn('Project JSON parse failed', e);
    }
    return null;
}
