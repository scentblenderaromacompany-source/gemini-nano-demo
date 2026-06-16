// Gemini Nano Assistant — Side Panel with Skills
// Runs entirely on-device via Chrome's built-in Prompt API

let session = null;
let mode = 'chat';
let activeSkill = null;
let conversationHistory = [];
let currentModel = 'auto'; // Hybrid AI model selection

// --- Init ---
async function init() {
    const status = document.getElementById('status');
    try {
        if (typeof LanguageModel === 'undefined') {
            status.textContent = 'API N/A';
            status.className = 'error';
            addMessage('system', 'LanguageModel API not available.\nEnable: chrome://flags/#optimization-guide-on-device-model');
            return;
        }

        const avail = await LanguageModel.availability();
        if (avail !== 'available' && avail !== 'downloadable') {
            status.textContent = avail;
            status.className = 'error';
            return;
        }

        status.textContent = 'Loading model...';
        session = await LanguageModel.create({
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    status.textContent = `${(e.loaded * 100).toFixed(0)}%`;
                });
            }
        });

        status.textContent = 'Ready';
        status.className = 'ready';
        renderSkills();
    } catch (err) {
        status.textContent = 'Error';
        status.className = 'error';
        addMessage('system', `Init error: ${err.message}`);
    }
}

// --- Skills ---
function renderSkills() {
    const bar = document.getElementById('skill-bar');
    bar.innerHTML = '';

    const categories = getSkillsByCategory();
    for (const [cat, skills] of Object.entries(categories)) {
        if (skills.length === 0) continue;

        const label = document.createElement('span');
        label.style.cssText = 'font-size:0.6rem;color:#555;padding:0.3rem 0.3rem;white-space:nowrap;align-self:center;';
        label.textContent = cat;
        bar.appendChild(label);

        for (const skill of skills) {
            const chip = document.createElement('span');
            chip.className = 'skill-chip';
            chip.dataset.skillId = skill.id;
            chip.innerHTML = `${skill.icon} ${skill.name}`;
            chip.title = skill.description;
            chip.onclick = () => activateSkill(skill.id);
            bar.appendChild(chip);
        }
    }
}

function activateSkill(skillId) {
    const skill = getSkill(skillId);
    if (!skill) return;

    activeSkill = skill;

    // Update UI
    document.querySelectorAll('.skill-chip').forEach(c => c.classList.remove('active'));
    const chip = document.querySelector(`[data-skill-id="${skillId}"]`);
    if (chip) chip.classList.add('active');

    const panel = document.getElementById('skill-panel');
    panel.classList.add('visible');
    document.getElementById('skill-icon').textContent = skill.icon;
    document.getElementById('skill-name').textContent = skill.name;
    document.getElementById('skill-desc').textContent = skill.description;

    // Set appropriate mode
    if (skill.mode === 'page' || skill.mode === 'selection-or-page') {
        setMode(document.querySelector('[data-mode="page"]'));
    } else if (skill.mode === 'selection') {
        setMode(document.querySelector('[data-mode="selection"]'));
    }

    // Update context info
    const ctx = document.getElementById('skill-context');
    const modeDesc = {
        'page': '📄 Will include current page content as context',
        'selection': '✂️ Will include selected text — select text on the page first',
        'selection-or-page': '✂️📄 Will use selected text if available, otherwise full page',
        'chat': '💬 Free-form chat with this skill\'s system prompt',
    };
    ctx.textContent = modeDesc[skill.mode] || '';

    addMessage('system', `Skill activated: ${skill.icon} ${skill.name} — ${skill.description}`);
}

function deactivateSkill() {
    activeSkill = null;
    document.querySelectorAll('.skill-chip').forEach(c => c.classList.remove('active'));
    document.getElementById('skill-panel').classList.remove('visible');
    addMessage('system', 'Skill deactivated — back to free chat');
}

// --- Context Extraction ---
async function getPageText() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const walker = document.createTreeWalker(
                    document.body, NodeFilter.SHOW_TEXT, {
                        acceptNode: (node) => {
                            const p = node.parentElement;
                            if (!p || ['SCRIPT','STYLE','NOSCRIPT'].includes(p.tagName))
                                return NodeFilter.FILTER_REJECT;
                            const s = window.getComputedStyle(p);
                            if (s.display === 'none' || s.visibility === 'hidden')
                                return NodeFilter.FILTER_REJECT;
                            return NodeFilter.FILTER_ACCEPT;
                        }
                    });
                let text = '', node;
                while ((node = walker.nextNode())) {
                    const t = node.textContent.trim();
                    if (t) text += t + '\n';
                }
                return text.substring(0, 5000);
            }
        });
        return results?.[0]?.result || '';
    } catch { return ''; }
}

async function getCodeBlocks() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const blocks = [];
                document.querySelectorAll('pre, code, .highlight, [class*="language-"]').forEach(el => {
                    const text = el.textContent.trim();
                    if (text.length > 10 && text.length < 10000) {
                        blocks.push(text);
                    }
                });
                return blocks.join('\n\n---\n\n').substring(0, 5000);
            }
        });
        return results?.[0]?.result || '';
    } catch { return ''; }
}

async function getSelection() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection().toString()
        });
        return results?.[0]?.result || '';
    } catch { return ''; }
}

async function getContextForSkill(skill) {
    if (!skill) return '';

    if (skill.extract === 'code-blocks') {
        const sel = await getSelection();
        if (sel) return `Code:\n\`\`\`\n${sel}\n\`\`\``;
        const code = await getCodeBlocks();
        if (code) return `Code found on page:\n\`\`\`\n${code}\n\`\`\``;
        return await getPageText();
    }

    if (skill.extract === 'full-page') {
        return await getPageText();
    }

    // Default: selection or page
    const sel = await getSelection();
    if (sel) return sel;
    return await getPageText();
}

// --- Chat ---
function addMessage(type, text) {
    const chat = document.getElementById('chat');
    const div = document.createElement('div');
    div.className = `msg msg-${type}`;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
}

async function sendMessage() {
    const input = document.getElementById('user-input');
    const userText = input.value.trim();
    if (!userText) return;

    input.value = '';
    autoResize(input);
    addMessage('user', userText);

    const btn = document.getElementById('send-btn');
    btn.disabled = true;

    // Check if active skill uses built-in Chrome API
    if (activeSkill && activeSkill.useBuiltInApi) {
        try {
            const apiResult = await callBuiltInApi(activeSkill.useBuiltInApi, userText);
            addMessage('skill', `[⚡ ${activeSkill.name}] ${apiResult}`);
        } catch (err) {
            addMessage('system', `Error: ${err.message}`);
        }
        btn.disabled = false;
        return;
    }

    // Handle browser skills (agent-browser via bridge)
    if (activeSkill && activeSkill.browserAction) {
        try {
            const result = await callBrowserApi(activeSkill.browserAction, userText);
            addMessage('skill', `[🖱️ ${activeSkill.name}] ${result}`);
        } catch (err) {
            addMessage('system', `Error: ${err.message}`);
        }
        btn.disabled = false;
        return;
    }

    // Handle WebMCP skills
    if (activeSkill && activeSkill.webmcpAction) {
        try {
            const result = await callWebMcpApi(activeSkill.webmcpAction, userText, activeSkill);
            addMessage('skill', `[🔌 ${activeSkill.name}] ${result}`);
        } catch (err) {
            addMessage('system', `Error: ${err.message}`);
        }
        btn.disabled = false;
        return;
    }

    // Handle Agent skills (extension-side autonomous loop)
    if (activeSkill && activeSkill.agentAction) {
        try {
            const result = await callAgentApi(activeSkill.agentAction, userText);
            addMessage('skill', `[🤖 ${activeSkill.name}] ${result}`);
        } catch (err) {
            addMessage('system', `Error: ${err.message}`);
        }
        btn.disabled = false;
        return;
    }

    // Handle Hybrid AI skills (model selection)
    if (activeSkill && activeSkill.hybridModel) {
        currentModel = activeSkill.hybridModel;
        addMessage('skill', `[🔀 ${activeSkill.name}] Model set to: ${currentModel}`);
        btn.disabled = false;
        return;
    }

    // Handle Memory skills
    if (activeSkill && activeSkill.memoryAction) {
        try {
            const result = await callMemoryApi(activeSkill.memoryAction, userText);
            addMessage('skill', `[🧠 ${activeSkill.name}] ${result}`);
        } catch (err) {
            addMessage('system', `Error: ${err.message}`);
        }
        btn.disabled = false;
        return;
    }

    // Hybrid AI path: call bridge with model selection
    try {
        const aiMsg = addMessage('ai', '');
        
        const response = await fetch('http://localhost:8765/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: conversationHistory.concat({ role: 'user', content: userText }),
                stream: false,
                temperature: 0.7,
                max_tokens: 1024,
                model: currentModel,
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        const result = data.choices?.[0]?.message?.content || 'No response';
        aiMsg.textContent = result;
        conversationHistory.push({ role: 'assistant', content: result });
        
    } catch (err) {
        aiMsg.textContent = `Error: ${err.message}`;
    }

    btn.disabled = false;
}


// --- UI ---
function setMode(el) {
    if (!el) return;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    mode = el.dataset.mode;
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Auto-resize input
document.getElementById('user-input').addEventListener('input', function() {
    autoResize(this);
});

// Enter to send, Shift+Enter for newline
document.getElementById('user-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Open side panel on icon click
chrome.action.onClicked.addListener(() => {
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});

// Skill close button
document.getElementById('skill-close-btn').addEventListener('click', deactivateSkill);

// Mode buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn));
});

// Send button
document.getElementById('send-btn').addEventListener('click', sendMessage);

// Paste image handler
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = async () => {
                const b64 = reader.result.split(',')[1];
                addMessage('user', '[Pasted image]');
                const aiMsg = addMessage('ai', 'Analyzing image...');
                try {
                    const result = await window.analyzeImage(b64, 'Describe this image in detail');
                    aiMsg.textContent = result;
                } catch (err) {
                    aiMsg.textContent = `Error: ${err.message}`;
                }
            };
            reader.readAsDataURL(blob);
            break;
        }
    }
});

// Image analysis via bridge
window.analyzeImage = async function(imageB64, prompt) {
    const resp = await fetch('http://localhost:8765/v1/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageB64, prompt })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.result;
};

// ── Built-in Chrome AI APIs via bridge ──
window.callBuiltInApi = async function(api, text, options = {}) {
    const endpoints = {
        'summarizer': '/v1/summarize',
        'translator': '/v1/translate',
        'language-detector': '/v1/detect-language',
    };
    const endpoint = endpoints[api];
    if (!endpoint) throw new Error('Unknown built-in API: ' + api);

    const resp = await fetch(`http://localhost:8765${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...options })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.result;
};

// ── Browser control via bridge (agent-browser) ──
window.callBrowserApi = async function(action, input) {
    const endpoints = {
        'open': '/v1/browser/open',
        'snapshot': '/v1/browser/snapshot',
        'click': '/v1/browser/click',
        'fill': '/v1/browser/fill',
        'press': '/v1/browser/press',
        'scroll': '/v1/browser/scroll',
        'close': '/v1/browser/close',
        'agent': '/v1/browser/agent',
    };
    const endpoint = endpoints[action];
    if (!endpoint) throw new Error('Unknown browser action: ' + action);

    let body = {};
    if (action === 'open') body = { url: input };
    else if (action === 'click') body = { ref: input };
    else if (action === 'fill') {
        // Expect "ref value" or JSON
        try { body = JSON.parse(input); }
        catch { const [ref, ...rest] = input.split(' '); body = { ref, value: rest.join(' ') }; }
    }
    else if (action === 'press') body = { key: input || 'Enter' };
    else if (action === 'scroll') body = { direction: input || 'down', amount: 500 };
    else if (action === 'agent') body = { task: input, maxSteps: 20 };
    else if (action === 'snapshot') body = {};
    else if (action === 'close') body = {};

    const resp = await fetch(`http://localhost:8765${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.result || JSON.stringify(data);
};

// ── WebMCP via bridge ──
window.callWebMcpApi = async function(action, input, skill) {
    const tabId = await getCurrentTabId();
    if (!tabId) throw new Error('No active tab');

    if (action === 'discover') {
        const resp = await fetch('http://localhost:8765/v1/webmcp/discover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabId })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        const tools = data.tools?.toolsRegistered || [];
        if (tools.length === 0) return 'No WebMCP tools registered on this page. Try a page with WebMCP tools or refresh the page.';
        return `Found ${tools.length} WebMCP tool(s):\n` + tools.map(t => `  • ${t.name}: ${t.description}`).join('\n');
    }

    if (action === 'call') {
        let toolName = skill.webmcpTool;
        let args = {};

        if (skill.webmcpTool) {
            // Pre-configured tool (e.g., search_page, extract_links)
            if (input.trim()) {
                try { args = JSON.parse(input); }
                catch {
                    // For search_page, treat input as query
                    if (skill.webmcpTool === 'search_page') args = { query: input };
                    else if (skill.webmcpTool === 'click_element') args = { selector: input };
                    else throw new Error('Provide JSON arguments or use pre-configured input format');
                }
            }
        } else {
            // Generic call tool - expect "toolName JSON" or just JSON with toolName in it
            try {
                const parsed = JSON.parse(input);
                if (parsed.toolName) { toolName = parsed.toolName; args = parsed.args || {}; }
                else throw new Error('toolName required');
            } catch {
                const parts = input.trim().split(/\s+/);
                toolName = parts[0];
                try { args = JSON.parse(parts.slice(1).join(' ')); } catch { args = {}; }
            }
        }

        if (!toolName) throw new Error('Tool name required');

        const resp = await fetch('http://localhost:8765/v1/webmcp/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabId, toolName, args })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        return JSON.stringify(data.result, null, 2);
    }

    throw new Error('Unknown WebMCP action: ' + action);
};

// ── Agent Loop API (extension-side) ──
window.callAgentApi = async function(action, input) {
    const endpoints = {
        'start': '/v1/agent/start',
        'step': '/v1/agent/step',
        'status': '/v1/agent/status',
        'stop': '/v1/agent/stop',
    };
    const endpoint = endpoints[action];
    if (!endpoint) throw new Error('Unknown agent action: ' + action);

    let body = {};
    if (action === 'start') {
        // Input: "task description" or JSON with maxSteps
        try { body = JSON.parse(input); }
        catch { body = { task: input, maxSteps: 20 }; }
    } else if (action === 'step') {
        body = { sessionId: input || getActiveSessionId() };
    } else if (action === 'status') {
        body = { sessionId: input || getActiveSessionId() };
    } else if (action === 'stop') {
        body = { sessionId: input || getActiveSessionId() };
    }

    const resp = await fetch(`http://localhost:8765${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    
    const result = data.result;
    
    // Store sessionId for step/status/stop
    if (action === 'start' && result?.sessionId) {
        window.activeAgentSessionId = result.sessionId;
    }
    
    return JSON.stringify(result, null, 2);
};

// ── Memory API ──
window.callMemoryApi = async function(action, input) {
    const endpoints = {
        'save': '/v1/memory/session/create',
        'load': '/v1/memory/session/',
        'list': '/v1/memory/sessions',
        'search': '/v1/memory/search',
        'stats': '/v1/memory/stats',
        'learn': '/v1/memory/memory/create',
    };
    const endpoint = endpoints[action];
    if (!endpoint) throw new Error('Unknown memory action: ' + action);

    let body = {}, method = 'POST';
    if (action === 'save') {
        try { body = JSON.parse(input); }
        catch { body = { task: input, model: currentModel }; }
    } else if (action === 'load') {
        // GET request with session ID
        method = 'GET';
    } else if (action === 'list') {
        method = 'GET';
    } else if (action === 'search') {
        try { body = JSON.parse(input); }
        catch { body = { query: input }; }
    } else if (action === 'stats') {
        method = 'GET';
    } else if (action === 'learn') {
        body = { type: 'pattern', content: input, tags: ['manual'], confidence: 0.8 };
    }

    const url = method === 'GET' && input 
        ? `http://localhost:8765${endpoint}${input}`
        : `http://localhost:8765${endpoint}`;
    
    const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(body) : undefined
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    
    // Format output nicely
    if (action === 'stats') return JSON.stringify(data.stats, null, 2);
    if (action === 'list') return JSON.stringify(data.sessions, null, 2);
    if (action === 'search') return JSON.stringify(data.memories, null, 2);
    if (data.session) return JSON.stringify(data.session, null, 2);
    if (data.memory) return JSON.stringify(data.memory, null, 2);
    
    return JSON.stringify(data, null, 2);
};

let activeAgentSessionId = null;
function getActiveSessionId() {
    return activeAgentSessionId;
}

async function getCurrentTabId() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.id;
    } catch { return null; }
}

init();
