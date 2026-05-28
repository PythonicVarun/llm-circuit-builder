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
const sessionInput = $('#session-input');
const sessionList = $('#session-list');
const sessionNewBtn = $('#session-new');
const sessionDeleteBtn = $('#session-delete');
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
const SESSIONS_KEY = 'circuit-lab.sessions';        // { sessions: [...], activeId }
const LEGACY_SESSION_KEY = 'circuit-lab.session';   // single-session predecessor
let llmCfg = loadCfg();
let llm = llmCfg ? new LLMClient(llmCfg) : null;

let wokwi = null;
let wokwiReady = false;
let isStreaming = false;

// Live mirror of the active session — DOM code reads/writes these directly,
// and saveSession() flushes them back into the session record.
let conversation = []; // [{role,content}] sent to LLM
let currentProject = null;

// Multi-session store. Each session = { id, title, createdAt, updatedAt,
// conversation, currentProject }. We keep them all in localStorage under one
// key plus an activeId pointer.
let sessions = [];   // newest first
let activeId = null;

function newSessionObj() {
    return {
        id: 's_' + Math.random().toString(36).slice(2, 10),
        title: 'untitled',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversation: [],
        currentProject: null,
    };
}

function activeSession() {
    return sessions.find(s => s.id === activeId) || null;
}

function deriveTitle(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 38 ? t.slice(0, 38) + '…' : (t || 'untitled');
}

function persistSessions() {
    const payload = { sessions, activeId };
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(payload));
    } catch (e) {
        // quota — drop compiled hex from all sessions and retry.
        const slim = {
            activeId,
            sessions: sessions.map(s => {
                if (!s.currentProject?.files?.['sketch.hex']) return s;
                const cp = { ...s.currentProject, files: { ...s.currentProject.files } };
                delete cp.files['sketch.hex'];
                return { ...s, currentProject: cp };
            }),
        };
        try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(slim)); } catch { }
    }
}

function loadSessions() {
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && Array.isArray(obj.sessions) && obj.sessions.length) {
                sessions = obj.sessions;
                activeId = obj.activeId && sessions.find(s => s.id === obj.activeId)
                    ? obj.activeId : sessions[0].id;
                return;
            }
        }
        // Migrate legacy single-session blob if present.
        const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
        if (legacy) {
            const parsed = JSON.parse(legacy);
            const s = newSessionObj();
            s.conversation = Array.isArray(parsed.conversation) ? parsed.conversation : [];
            s.currentProject = parsed.currentProject || null;
            const firstUser = s.conversation.find(m => m.role === 'user');
            if (firstUser) s.title = deriveTitle(firstUser.content);
            sessions = [s];
            activeId = s.id;
            localStorage.removeItem(LEGACY_SESSION_KEY);
            persistSessions();
            return;
        }
    } catch { }
    // Fresh start.
    const s = newSessionObj();
    sessions = [s];
    activeId = s.id;
}

function saveSession() {
    const s = activeSession();
    if (s) {
        s.conversation = conversation;
        s.currentProject = currentProject;
        // First user message becomes the title.
        if ((s.title === 'untitled' || !s.title) && conversation.length) {
            const firstUser = conversation.find(m => m.role === 'user');
            if (firstUser) s.title = deriveTitle(firstUser.content);
        }
        s.updatedAt = Date.now();
    }
    persistSessions();
    renderSessionPicker();
}

// Searchable combobox state. The input doubles as filter + display: when the
// dropdown is closed it shows the active session's title; when open, whatever
// the user is typing.
let sessionQuery = '';
let sessionListOpen = false;
let sessionFocusIdx = -1;

function renderSessionPicker() {
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    sessionDeleteBtn.disabled = sessions.length <= 1;
    if (!sessionListOpen) {
        const cur = activeSession();
        sessionInput.value = cur?.title || '';
    }
    renderSessionList();
}

function fmtRelative(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)}m`;
    if (d < 86400) return `${Math.floor(d / 3600)}h`;
    return `${Math.floor(d / 86400)}d`;
}

function filteredSessions() {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s => {
        if ((s.title || '').toLowerCase().includes(q)) return true;
        // also match content of conversation
        return s.conversation.some(m => String(m.content || '').toLowerCase().includes(q));
    });
}

function renderSessionList() {
    sessionList.innerHTML = '';
    const list = filteredSessions();
    if (!list.length) {
        const div = document.createElement('div');
        div.className = 'session-empty';
        div.textContent = 'No matching sessions';
        sessionList.appendChild(div);
        return;
    }
    list.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'session-item' + (s.id === activeId ? ' active' : '') + (i === sessionFocusIdx ? ' focused' : '');
        row.setAttribute('role', 'option');
        row.dataset.id = s.id;
        const title = document.createElement('span');
        title.textContent = s.title || 'untitled';
        const meta = document.createElement('span');
        meta.className = 'session-meta';
        meta.textContent = fmtRelative(s.updatedAt);
        row.appendChild(title);
        row.appendChild(meta);
        row.addEventListener('mousedown', (e) => {
            // mousedown (not click) so the input blur doesn't close the list first
            e.preventDefault();
            pickSession(s.id);
        });
        sessionList.appendChild(row);
    });
}

function openSessionList() {
    sessionListOpen = true;
    sessionFocusIdx = -1;
    sessionList.classList.remove('hidden');
    renderSessionList();
}
function closeSessionList() {
    sessionListOpen = false;
    sessionQuery = '';
    sessionList.classList.add('hidden');
    // restore the visible title
    const cur = activeSession();
    sessionInput.value = cur?.title || '';
}

function pickSession(id) {
    closeSessionList();
    if (id !== activeId) switchSession(id);
}

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

// Multi-session controls — searchable combobox
sessionInput.addEventListener('focus', () => {
    sessionInput.value = '';
    sessionQuery = '';
    openSessionList();
});
sessionInput.addEventListener('input', () => {
    sessionQuery = sessionInput.value;
    sessionFocusIdx = -1;
    if (!sessionListOpen) openSessionList();
    else renderSessionList();
});
sessionInput.addEventListener('blur', () => {
    // small delay so a click on an item can fire first
    setTimeout(() => { if (sessionListOpen) closeSessionList(); }, 120);
});
sessionInput.addEventListener('keydown', (e) => {
    const list = filteredSessions();
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!sessionListOpen) openSessionList();
        sessionFocusIdx = Math.min(list.length - 1, sessionFocusIdx + 1);
        renderSessionList();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sessionFocusIdx = Math.max(0, sessionFocusIdx - 1);
        renderSessionList();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = list[sessionFocusIdx >= 0 ? sessionFocusIdx : 0];
        if (pick) pickSession(pick.id);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        sessionInput.blur();
    }
});
sessionNewBtn.addEventListener('click', () => {
    const s = newSessionObj();
    sessions.unshift(s);
    activeId = s.id;
    persistSessions();
    loadActive();
});
sessionDeleteBtn.addEventListener('click', () => {
    if (sessions.length <= 1) return;
    const cur = activeSession();
    if (!cur) return;
    const ok = !cur.conversation.length || confirm(`Delete session "${cur.title}"?`);
    if (!ok) return;
    sessions = sessions.filter(s => s.id !== activeId);
    activeId = sessions[0].id;
    persistSessions();
    loadActive();
});

function switchSession(id) {
    if (!sessions.find(s => s.id === id)) return;
    activeId = id;
    persistSessions();
    loadActive();
}

// Pull the active session's data into the live vars + rerender the chat UI.
function loadActive() {
    const s = activeSession();
    conversation = s ? [...s.conversation] : [];
    currentProject = s ? s.currentProject : null;
    activeFilePath = null;

    messagesEl.querySelectorAll('.msg:not(.msg-system)').forEach(n => n.remove());
    for (const m of conversation) {
        if (m.role === 'user') {
            addMessage('user', m.content);
        } else if (m.role === 'assistant') {
            const clean = String(m.content).replace(/```wokwi-project[\s\S]*?```/i, '').trim();
            const el = addMessage('assistant', clean || 'Project generated.');
            const proj = extractProject(m.content);
            if (proj) addProjectSummary(el, proj);
        }
    }
    updateFilesBtnLabel();
    [btnStart, btnPause, btnStop, btnRestart, btnFiles].forEach(b => b.disabled = !currentProject);
    renderSessionPicker();
    if (currentProject && wokwiReady) runProject(currentProject);
}

async function send() {
    if (isStreaming) return;
    const text = promptEl.value.trim();
    if (!text) return;
    if (!llm) { openSettings(); return; }

    promptEl.value = '';
    addMessage('user', text);
    conversation.push({ role: 'user', content: text });
    saveSession();

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
        saveSession();
    } else {
        currentProject = project;
        updateFilesBtnLabel();
        addProjectSummary(asstEl, project);
        saveSession();
        await runProject(project);
        saveSession(); // pick up sketch.hex / start changes from AVR compile
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
loadSessions();
loadActive();
if (!llmCfg) {
    // gentle nudge on first load
    setTimeout(openSettings, 250);
}
