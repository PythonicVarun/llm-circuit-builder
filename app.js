import { MessagePortTransport } from './message-port-transport.js';
import { WokwiClient } from './wokwi-client.js';
import { LLMClient, extractProject } from './llm.js';
import { buildZip, buildTree, downloadBlob } from './zip.js';
import { detectAvrBoard, buildArduinoHex } from './build.js';

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
const btnStop = $('#btn-stop');
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
const filesModal       = $('#files-modal');
const filesClose       = $('#files-close');
const filesTreeEl      = $('#files-tree');
const filesView        = $('#files-view');
const filesCountEl     = $('#files-count');
const filesActivePath  = $('#files-active-path');
const filesDownloadBtn = $('#files-download');
const filesDownloadOne = $('#files-download-one');

let activeFilePath = null;

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

// files explorer modal
btnFiles.addEventListener('click', () => {
    if (!currentProject) return;
    renderFiles();
    filesModal.classList.remove('hidden');
});
filesClose.addEventListener('click', () => filesModal.classList.add('hidden'));
filesModal.addEventListener('click', (e) => { if (e.target === filesModal) filesModal.classList.add('hidden'); });

filesDownloadBtn.addEventListener('click', () => {
    if (!currentProject) return;
    const flat = Object.fromEntries(
        Object.entries(currentProject.files).map(([k, v]) => [
            k, typeof v === 'string' ? v : JSON.stringify(v, null, 2)
        ])
    );
    const zip = buildZip(flat);
    downloadBlob(zip, projectZipName());
});

filesDownloadOne.addEventListener('click', () => {
    if (!activeFilePath || !currentProject) return;
    const v = currentProject.files[activeFilePath];
    const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, activeFilePath.split('/').pop());
});

function projectZipName() {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `circuit-lab-${stamp}.zip`;
}

const ICON_FOLDER = `<svg class="icon" viewBox="0 0 16 16"><path d="M1.5 3.5h4l1.5 1.5h7v8.5h-12.5z" fill="currentColor" opacity=".25"/><path d="M1.5 3.5h4l1.5 1.5h7v8.5h-12.5z" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linejoin="round"/></svg>`;
const ICON_FILE   = `<svg class="icon" viewBox="0 0 16 16"><path d="M3 2h7l3 3v9H3z" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linejoin="round"/><path d="M10 2v3h3" stroke="currentColor" stroke-width="1.1" fill="none"/></svg>`;

function renderFiles() {
    activeFilePath = null;
    filesActivePath.textContent = 'No file selected';
    filesView.textContent = 'Select a file from the tree';
    filesDownloadOne.disabled = true;

    const names = Object.keys(currentProject.files);
    filesCountEl.textContent = `· ${names.length} file${names.length === 1 ? '' : 's'}`;

    filesTreeEl.innerHTML = '';
    const tree = buildTree(names);
    filesTreeEl.appendChild(renderTreeNode(tree, ''));

    // auto-select first file
    const first = filesTreeEl.querySelector('.tree-row.file');
    if (first) first.click();
}

function renderTreeNode(node, prefix) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node';

    // sorted folders first, then files
    const folderNames = Object.keys(node.folders).sort();
    const fileNames   = Object.keys(node.files).sort();

    for (const name of folderNames) {
        const row = document.createElement('div');
        row.className = 'tree-row folder';
        row.innerHTML = `<span class="caret">▾</span>${ICON_FOLDER}<span class="name">${escapeHtml(name)}</span>`;
        const children = document.createElement('div');
        children.className = 'tree-children';
        children.appendChild(renderTreeNode(node.folders[name], prefix + name + '/'));
        row.addEventListener('click', () => {
            row.classList.toggle('collapsed');
            children.classList.toggle('hidden');
        });
        wrap.appendChild(row);
        wrap.appendChild(children);
    }

    for (const name of fileNames) {
        const fullPath = node.files[name];
        const row = document.createElement('div');
        row.className = 'tree-row file';
        row.innerHTML = `<span class="caret" style="visibility:hidden">·</span>${ICON_FILE}<span class="name">${escapeHtml(name)}</span>`;
        row.addEventListener('click', () => selectFile(fullPath, row));
        wrap.appendChild(row);
    }
    return wrap;
}

function selectFile(path, rowEl) {
    activeFilePath = path;
    filesTreeEl.querySelectorAll('.tree-row.active').forEach(n => n.classList.remove('active'));
    rowEl.classList.add('active');
    const content = currentProject.files[path];
    filesView.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    filesActivePath.textContent = path;
    filesDownloadOne.disabled = false;
}

function updateFilesBtnLabel() {
    if (!currentProject) {
        btnFiles.textContent = 'files…';
        return;
    }
    const n = Object.keys(currentProject.files).length;
    btnFiles.textContent = `files (${n})`;
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
    <div class="proj-actions">
      <button class="link-btn" data-act="browse">browse files &rsaquo;</button>
      <button class="link-btn" data-act="zip">download .zip &darr;</button>
    </div>
  `;
    div.querySelector('[data-act=browse]').addEventListener('click', () => {
        if (!currentProject) return;
        renderFiles();
        filesModal.classList.remove('hidden');
    });
    div.querySelector('[data-act=zip]').addEventListener('click', () => {
        if (!currentProject) return;
        const flat = Object.fromEntries(
            Object.entries(currentProject.files).map(([k, v]) => [
                k, typeof v === 'string' ? v : JSON.stringify(v, null, 2)
            ])
        );
        downloadBlob(buildZip(flat), projectZipName());
    });
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
    serialOutEl.textContent = '';

    // AVR boards (Uno/Mega/Nano/ATtiny) need pre-compiled firmware - the embed
    // doesn't compile them in-browser. Detect + build via hexi.wokwi.com,
    // then persist sketch.hex + the corrected start params back onto the
    // project so subsequent "start" clicks reuse them.
    const diagram = project.files['diagram.json'];
    const avrBoard = diagram ? detectAvrBoard(diagram) : null;
    if (avrBoard && project.files['sketch.ino'] && !project.files['sketch.hex']) {
        try {
            setSimStatus(`compiling (${avrBoard})…`, 'warn');
            const out = await buildArduinoHex(project.files['sketch.ino'], avrBoard);
            project.files['sketch.hex'] = out.hex;
            project.start = { firmware: 'sketch.hex', elf: 'sketch.hex' };
            updateFilesBtnLabel();
            if (out.stderr) console.warn('avr build warnings:', out.stderr);
        } catch (e) {
            setSimStatus('compile failed', 'err');
            addError(`Compile error (${avrBoard}): ${e.message}`);
            return;
        }
    } else if (avrBoard && project.files['sketch.hex']) {
        // Already compiled (e.g. user clicked "start" again) - make sure the
        // start params still point at the hex, not the original .ino.
        project.start = { firmware: 'sketch.hex', elf: 'sketch.hex' };
    }
    const start = project.start || guessStart(project.files);

    setSimStatus('uploading…', 'warn');
    try { await wokwi.simPause(); } catch { }
    for (const [name, content] of Object.entries(project.files)) {
        const str = typeof content === 'string' ? content : JSON.stringify(content);
        await wokwi.fileUpload(name, str);
    }
    setSimStatus('starting…', 'warn');
    try {
        await wokwi.simStart(start);
        setSimStatus('running', 'ok');
        [btnStart, btnPause, btnStop, btnRestart, btnFiles].forEach(b => b.disabled = false);
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
btnStop.addEventListener('click', async () => {
    try { await wokwi.simRestart({ pause: true }); setSimStatus('stopped', 'warn'); serialOutEl.textContent = ''; }
    catch (e) { addError(e.message); }
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
        updateFilesBtnLabel();
        addProjectSummary(asstEl, project);
        await runProject(project);
    }

    isStreaming = false;
    sendBtn.disabled = !llm;
}

// Debug hook: load a project without going through the LLM (used by manual
// testing and by anyone who wants to drop a hand-written project into Wokwi).
window.loadProject = async (project) => {
    currentProject = project;
    updateFilesBtnLabel();
    renderFiles();
    filesModal.classList.remove('hidden');
    if (wokwiReady) await runProject(project);
};

// Boot
updateLLMStatus();
setSimStatus('idle');
if (!llmCfg) {
    // gentle nudge on first load
    setTimeout(openSettings, 250);
}
