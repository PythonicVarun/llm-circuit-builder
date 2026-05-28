import { MessagePortTransport } from './message-port-transport.js';
import { WokwiClient } from './wokwi-client.js';
import { LLMClient, extractProject } from './llm.js';

// DOM elements
const $ = (s) => document.querySelector(s);
const messagesEl = $('#messages');
const promptEl = $('#prompt');
const composerEl = $('#composer');
const sendBtn = $('#send-btn');
const newChatBtn = $('#new-chat');
const llmStatusEl = $('#llm-status');
const simStatusEl = $('#sim-status');
const serialOutEl = $('#serial-out');
const serialClear = $('#serial-clear');
const btnStart = $('#btn-start');
const btnPause = $('#btn-pause');
const btnRestart = $('#btn-restart');
const btnFiles = $('#btn-files');

// settings modal
const settingsBtn = $('#settings-btn');
const settingsModal = $('#settings-modal');
const settingsClose = $('#settings-close');
const cfgBase = $('#cfg-base');
const cfgKey = $('#cfg-key');
const cfgModel = $('#cfg-model');
const cfgSave = $('#cfg-save');
const cfgClear = $('#cfg-clear');

// files modal
const filesModal = $('#files-modal');
const filesClose = $('#files-close');
const filesList = $('#files-list');
const filesView = $('#files-view');

// state
const STORAGE_KEY = 'circuit-lab.llm-config';
let llmCfg = loadCfg();
let llm = llmCfg ? new LLMClient(llmCfg) : null;

let wokwi = null;
let wokwiReady = false;
let conversation = []; // [{role,content}] sent to LLM
let currentProject = null; // last generated {files, start}
let isStreaming = false;

// LLM config persistence
function loadCfg() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (obj && obj.baseUrl && obj.apiKey && obj.model) return obj;
    } catch { }
    return null;
}
function saveCfg(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
function clearCfg() { localStorage.removeItem(STORAGE_KEY); }

function updateLLMStatus() {
    if (llmCfg) {
        llmStatusEl.textContent = `LLM: ${llmCfg.model}`;
        llmStatusEl.classList.remove('pill-warn');
        llmStatusEl.classList.add('pill-ok');
    } else {
        llmStatusEl.textContent = 'LLM: not configured';
        llmStatusEl.classList.add('pill-warn');
        llmStatusEl.classList.remove('pill-ok');
    }
    sendBtn.disabled = !llmCfg;
}

function setSimStatus(text, kind = '') {
    simStatusEl.textContent = `sim: ${text}`;
    simStatusEl.classList.remove('pill-ok', 'pill-warn', 'pill-err');
    if (kind) simStatusEl.classList.add(`pill-${kind}`);
}

// Modal helpers
function openSettings() {
    if (llmCfg) {
        cfgBase.value = llmCfg.baseUrl;
        cfgKey.value = llmCfg.apiKey;
        cfgModel.value = llmCfg.model;
    } else {
        cfgBase.value = cfgBase.value || 'https://api.openai.com/v1';
        cfgModel.value = cfgModel.value || 'gpt-4o-mini';
    }
    settingsModal.classList.remove('hidden');
    setTimeout(() => cfgBase.focus(), 0);
}
function closeSettings() { settingsModal.classList.add('hidden'); }

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

cfgSave.addEventListener('click', () => {
    const cfg = {
        baseUrl: cfgBase.value.trim(),
        apiKey: cfgKey.value.trim(),
        model: cfgModel.value.trim(),
    };
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        alert('All three fields are required.');
        return;
    }
    llmCfg = cfg;
    llm = new LLMClient(cfg);
    saveCfg(cfg);
    updateLLMStatus();
    closeSettings();
});

cfgClear.addEventListener('click', () => {
    clearCfg();
    llmCfg = null;
    llm = null;
    cfgBase.value = ''; cfgKey.value = ''; cfgModel.value = '';
    updateLLMStatus();
});

document.querySelectorAll('.preset').forEach((b) => {
    b.addEventListener('click', (e) => {
        e.preventDefault();
        cfgBase.value = b.dataset.base;
        cfgModel.value = b.dataset.model;
        cfgKey.focus();
    });
});

// files modal
btnFiles.addEventListener('click', () => {
    if (!currentProject) return;
    renderFiles();
    filesModal.classList.remove('hidden');
});
filesClose.addEventListener('click', () => filesModal.classList.add('hidden'));
filesModal.addEventListener('click', (e) => { if (e.target === filesModal) filesModal.classList.add('hidden'); });

function renderFiles() {
    filesList.innerHTML = '';
    const names = Object.keys(currentProject.files);
    names.forEach((name, i) => {
        const li = document.createElement('li');
        li.textContent = name;
        if (i === 0) { li.classList.add('active'); showFile(name); }
        li.addEventListener('click', () => {
            filesList.querySelectorAll('li').forEach(x => x.classList.remove('active'));
            li.classList.add('active');
            showFile(name);
        });
        filesList.appendChild(li);
    });
}
function showFile(name) {
    const content = currentProject.files[name];
    filesView.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

// Chat UI
function addMessage(role, text) {
    const el = document.createElement('div');
    el.className = `msg msg-${role}`;
    const p = document.createElement('div');
    p.className = 'msg-body';
    p.textContent = text;
    el.appendChild(p);
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
}

function setStreamingText(el, text) {
    const body = el.querySelector('.msg-body');
    body.textContent = text;
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addProjectSummary(el, project) {
    const div = document.createElement('div');
    div.className = 'proj-summary';
    const fileChips = Object.keys(project.files)
        .map(n => `<span class="file-chip">${escapeHtml(n)}</span>`).join('');
    div.innerHTML = `
    <div><b>${escapeHtml(project.explanation || 'Project generated.')}</b></div>
    <div style="margin-top:6px">files: ${fileChips}</div>
    <div style="margin-top:4px">firmware: <code>${escapeHtml(project.start?.firmware || '?')}</code></div>
  `;
    el.appendChild(div);
}

function addError(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-error';
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Wokwi connection
window.addEventListener('message', (event) => {
    // Wokwi sends a MessagePort once the iframe is ready
    if (!event.data || !event.data.port) return;
    if (wokwi) return; // ignore reconnects

    wokwi = new WokwiClient(new MessagePortTransport(event.data.port));
    wokwi.addEventListener('wokwi:connected', async () => {
        wokwiReady = true;
        setSimStatus('ready', 'ok');
        try { await wokwi.serialMonitorListen(); } catch { }
        // if user already generated a project before iframe was ready, start it now
        if (currentProject) await runProject(currentProject);
    });
    wokwi.addEventListener('serial-monitor:data', (ev) => {
        const bytes = new Uint8Array(ev.detail.bytes);
        serialOutEl.textContent += new TextDecoder().decode(bytes);
        serialOutEl.scrollTop = serialOutEl.scrollHeight;
    });
    wokwi.addEventListener('sim:resume', () => setSimStatus('running', 'ok'));
    wokwi.addEventListener('sim:pause', () => setSimStatus('paused', 'warn'));
});

async function runProject(project) {
    if (!wokwi || !wokwiReady) {
        setSimStatus('waiting for iframe…', 'warn');
        return;
    }
    setSimStatus('uploading…', 'warn');
    serialOutEl.textContent = '';

    try { await wokwi.simPause(); } catch { }

    for (const [name, content] of Object.entries(project.files)) {
        const str = typeof content === 'string' ? content : JSON.stringify(content);
        await wokwi.fileUpload(name, str);
    }
    const start = project.start || guessStart(project.files);
    setSimStatus('starting…', 'warn');
    try {
        await wokwi.simStart(start);
        setSimStatus('running', 'ok');
        [btnStart, btnPause, btnRestart, btnFiles].forEach(b => b.disabled = false);
    } catch (e) {
        setSimStatus('start failed', 'err');
        addError(`Simulator: ${e.message}`);
    }
}

function guessStart(files) {
    if (files['sketch.ino']) return { firmware: 'sketch.ino', elf: 'sketch.ino' };
    if (files['main.py']) return { firmware: 'main.py', elf: 'main.py' };
    const k = Object.keys(files).find(f => f !== 'diagram.json');
    return { firmware: k, elf: k };
}

// Sim controls
btnStart.addEventListener('click', async () => {
    if (currentProject) await runProject(currentProject);
});
btnPause.addEventListener('click', async () => {
    try {
        const s = await wokwi.simStatus();
        if (s.running) { await wokwi.simPause(); setSimStatus('paused', 'warn'); }
        else { await wokwi.simResume(); setSimStatus('running', 'ok'); }
    } catch (e) { addError(e.message); }
});
btnRestart.addEventListener('click', async () => {
    try { await wokwi.simRestart({ pause: false }); setSimStatus('running', 'ok'); serialOutEl.textContent = ''; }
    catch (e) { addError(e.message); }
});

serialClear.addEventListener('click', () => { serialOutEl.textContent = ''; });

// Send a prompt
composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
});
promptEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault(); send();
    }
});

// example chips
messagesEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('example')) {
        promptEl.value = e.target.textContent;
        promptEl.focus();
    }
});

newChatBtn.addEventListener('click', () => {
    conversation = [];
    messagesEl.querySelectorAll('.msg:not(.msg-system)').forEach(n => n.remove());
});

async function send() {
    if (isStreaming) return;
    const text = promptEl.value.trim();
    if (!text) return;
    if (!llm) { openSettings(); return; }

    promptEl.value = '';
    addMessage('user', text);
    conversation.push({ role: 'user', content: text });

    const asstEl = addMessage('assistant', '');
    asstEl.classList.add('cursor');
    isStreaming = true;
    sendBtn.disabled = true;

    let full = '';
    try {
        for await (const chunk of llm.stream(conversation)) {
            full += chunk;
            // hide raw JSON fence body live to keep the chat readable
            const display = full.replace(/```wokwi-project[\s\S]*?(```|$)/i, '⟨generating project…⟩');
            setStreamingText(asstEl, display);
        }
    } catch (e) {
        asstEl.classList.remove('cursor');
        addError(`LLM error: ${e.message}`);
        isStreaming = false;
        sendBtn.disabled = !llm;
        return;
    }
    asstEl.classList.remove('cursor');
    conversation.push({ role: 'assistant', content: full });

    // strip the project block from the visible message
    const cleanText = full.replace(/```wokwi-project[\s\S]*?```/i, '').trim();
    setStreamingText(asstEl, cleanText || 'Project generated.');

    const project = extractProject(full);
    if (!project) {
        addError('LLM did not return a valid wokwi-project block. Ask it to retry or refine the prompt.');
    } else {
        currentProject = project;
        addProjectSummary(asstEl, project);
        await runProject(project);
    }

    isStreaming = false;
    sendBtn.disabled = !llm;
}

// Boot
updateLLMStatus();
setSimStatus('idle');
if (!llmCfg) {
    // gentle nudge on first load
    setTimeout(openSettings, 250);
}
