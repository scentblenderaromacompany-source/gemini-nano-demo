#!/usr/bin/env node
// Gemini Nano Local API Bridge
// Exposes Chrome's Gemini Nano as an OpenAI-compatible HTTP API

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import { randomUUID } from 'crypto';

const app = express();
const PORT = process.env.PORT || 8765;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Health check ──
app.get('/health', (req, res) => {
    res.json({ status: 'ok', model: 'gemini-nano', backend: 'chrome-bridge' });
});

// ── OpenAI-compatible: List models ──
app.get('/v1/models', (req, res) => {
    res.json({
        object: 'list',
        data: [{
            id: 'gemini-nano',
            object: 'model',
            owned_by: 'chrome',
            permission: []
        }]
    });
});

// ── OpenAI-compatible: Chat completions ──
app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream = false, temperature = 0.7, max_tokens = 1024 } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages array is required' });
    }

    const prompt = convertMessages(messages);

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const completionId = `chatcmpl-${randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        try {
            const result = await streamToChrome(prompt, (chunk) => {
                const sseData = JSON.stringify({
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model: 'gemini-nano',
                    choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                });
                res.write(`data: ${sseData}\n\n`);
            });

            const finalData = JSON.stringify({
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: 'gemini-nano',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            });
            res.write(`data: ${finalData}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        } catch (err) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    } else {
        try {
            const result = await promptChrome(prompt, temperature);
            res.json({
                id: `chatcmpl-${randomUUID()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'gemini-nano',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: result },
                    finish_reason: 'stop'
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
});

// ── Image analysis endpoint ──
app.post('/v1/analyze-image', async (req, res) => {
    const { image, prompt = 'Describe this image in detail', format = 'text' } = req.body;

    if (!image) {
        return res.status(400).json({ error: 'image (base64 or URL) is required' });
    }

    try {
        const result = await builtInApi('analyze-image', { image, prompt });
        if (format === 'json') {
            try { res.json(JSON.parse(result)); } catch { res.json({ description: result }); }
        } else {
            res.json({ result });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Summarize via Chrome Summarizer API ──
app.post('/v1/summarize', async (req, res) => {
    const { text, type = 'key-points' } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
        const result = await builtInApi('summarizer', text, { type });
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Translate via Chrome Translator API ──
app.post('/v1/translate', async (req, res) => {
    const { text, targetLanguage = 'es' } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
        const result = await builtInApi('translator', text, { targetLanguage });
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Detect language via Chrome Language Detector API ──
app.post('/v1/detect-language', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
        const result = await builtInApi('language-detector', text);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Screenshot + analyze endpoint ──
app.post('/v1/screenshot-analyze', async (req, res) => {
    const { tabId, prompt = 'Describe what you see on this page' } = req.body;

    try {
        const result = await screenshotAndAnalyze(tabId, prompt);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Browser control endpoints (agent-browser) ──
app.post('/v1/browser/open', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    try {
        const result = await runAgentBrowser('open', url);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/browser/snapshot', async (req, res) => {
    try {
        const result = await runAgentBrowser('snapshot');
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/browser/click', async (req, res) => {
    const { ref } = req.body;
    if (!ref) return res.status(400).json({ error: 'ref (e.g. @e3) is required' });
    try {
        const result = await runAgentBrowser('click', ref);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/browser/fill', async (req, res) => {
    const { ref, value } = req.body;
    if (!ref || value === undefined) return res.status(400).json({ error: 'ref and value are required' });
    try {
        const result = await runAgentBrowser('fill', ref, value);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/browser/press', async (req, res) => {
    const { key = 'Enter' } = req.body;
    try {
        const result = await runAgentBrowser('press', key);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/browser/scroll', async (req, res) => {
    const { direction = 'down', amount = 500 } = req.body;
    try {
        const result = await runAgentBrowser('scroll', direction, String(amount));
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/browser/close', async (req, res) => {
    try {
        const result = await runAgentBrowser('close', '--all');
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Autonomously run a browsing task (agent loop on the bridge side)
app.post('/v1/browser/agent', async (req, res) => {
    const { task, maxSteps = 20 } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    try {
        const result = await browserAgentLoop(task, maxSteps);
        res.json({ result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Browser screenshot endpoint ──
import fs from 'fs';

app.post('/v1/browser/screenshot', async (req, res) => {
    const { path, annotate = true, fullPage = false, quality = 80 } = req.body;
    try {
        const args = ['screenshot'];
        if (path) args.push(path);
        if (annotate) args.push('--annotate');
        if (fullPage) args.push('--fullpage');
        args.push('--screenshot-quality', String(quality));
        args.push('--screenshot-format', 'png');
        
        const result = await runAgentBrowser(...args);
        
        // If result has a file path, read it as base64
        const screenshotPath = result.data?.path || result.result?.data?.path;
        let base64 = null;
        if (screenshotPath && fs.existsSync(screenshotPath)) {
            base64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });
        }
        
        res.json({ result: { ...result, base64 } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── WebMCP endpoints ──
app.post('/v1/webmcp/discover', async (req, res) => {
    const { tabId } = req.body;
    if (!tabId) return res.status(400).json({ error: 'tabId is required' });
    try {
        const result = await sendToChrome('webmcp-discover', { tabId }, 30000);
        if (result.error) throw new Error(result.error);
        res.json({ tools: result.tools });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/webmcp/call', async (req, res) => {
    const { tabId, toolName, args } = req.body;
    if (!tabId || !toolName) return res.status(400).json({ error: 'tabId and toolName required' });
    try {
        const result = await sendToChrome('webmcp-call', { tabId, toolName, args }, 60000);
        if (result.error) throw new Error(result.error);
        res.json({ result: result.result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/v1/webmcp/register', async (req, res) => {
    const { tabId, tools } = req.body;
    if (!tabId || !tools) return res.status(400).json({ error: 'tabId and tools array required' });
    try {
        const result = await sendToChrome('webmcp-register', { tabId, tools }, 10000);
        if (result.error) throw new Error(result.error);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════
// Chrome Communication Layer
// ══════════════════════════════════════════════════════════

const pendingRequests = new Map();
let chromeWs = null;

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[Bridge] Chrome extension connected');
    chromeWs = ws;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            const pending = pendingRequests.get(msg.id);
            if (pending) {
                pending.resolve(msg);
                pendingRequests.delete(msg.id);
            }
        } catch (e) {
            console.error('[Bridge] Parse error:', e);
        }
    });

    ws.on('close', () => {
        console.log('[Bridge] Chrome extension disconnected');
        chromeWs = null;
        for (const [id, pending] of pendingRequests) {
            pending.reject(new Error('Chrome extension disconnected'));
        }
        pendingRequests.clear();
    });
});

function sendToChrome(type, payload, timeout = 120000) {
    return new Promise((resolve, reject) => {
        if (!chromeWs || chromeWs.readyState !== 1) {
            return reject(new Error('Chrome extension not connected. Open the extension and ensure it connects to the bridge.'));
        }

        const id = randomUUID();
        const timer = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Timeout waiting for Chrome response'));
        }, timeout);

        pendingRequests.set(id, {
            resolve: (msg) => { clearTimeout(timer); resolve(msg); },
            reject: (err) => { clearTimeout(timer); reject(err); }
        });

        chromeWs.send(JSON.stringify({ id, type, ...payload }));
    });
}

function convertMessages(messages) {
    let system = '';
    const userMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            system += msg.content + '\n\n';
        } else if (msg.role === 'user') {
            if (Array.isArray(msg.content)) {
                const textParts = msg.content.filter(p => p.type === 'text').map(p => p.text);
                userMessages.push(textParts.join('\n'));
            } else {
                userMessages.push(msg.content);
            }
        } else if (msg.role === 'assistant') {
            userMessages.push(`Assistant: ${msg.content}`);
        }
    }

    let prompt = '';
    if (system) prompt += `[System] ${system}\n`;
    prompt += userMessages.join('\n\n');
    return prompt;
}

async function promptChrome(prompt, temperature = 0.7) {
    const response = await sendToChrome('prompt', { prompt, temperature }, 180000);
    if (response.error) throw new Error(response.error);
    return response.result;
}

async function streamToChrome(prompt, onChunk) {
    const response = await sendToChrome('prompt-stream', { prompt }, 60000);
    if (response.error) throw new Error(response.error);

    const text = response.result;
    const chunkSize = 20;
    for (let i = 0; i < text.length; i += chunkSize) {
        onChunk(text.substring(i, i + chunkSize));
        await new Promise(r => setTimeout(r, 10));
    }
}

// Built-in Chrome AI APIs dispatcher
async function builtInApi(api, data, options = {}) {
    const response = await sendToChrome(api, { text: data, ...options }, 30000);
    if (response.error) throw new Error(response.error);
    return response.result;
}

async function screenshotAndAnalyze(tabId, prompt) {
    const response = await sendToChrome('screenshot-analyze', { tabId, prompt }, 60000);
    if (response.error) throw new Error(response.error);
    return response.result;
}

// ── agent-browser runner ──
import { execSync } from 'child_process';

const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN ||
    '/home/bobby/.local/lib/node_modules/agent-browser/bin/agent-browser.js';
const AB_SESSION = 'gemini-nano-bridge';

function runAgentBrowser(...args) {
    const cmd = [AGENT_BROWSER_BIN, '--session', AB_SESSION, '--json', ...args.map(String)];
    try {
        const out = execSync(cmd.join(' '), {
            timeout: 30000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (out.trim()) {
            try { return JSON.parse(out); }
            catch { return { raw: out.trim() }; }
        }
        return { ok: true };
    } catch (e) {
        const stdout = e.stdout?.toString().trim();
        if (stdout) {
            try { return JSON.parse(stdout); } catch { return { raw: stdout }; }
        }
        throw new Error(e.stderr?.toString().trim() || e.message);
    }
}

// ── Browser agent loop (bridge-side) ──
const BROWSER_AGENT_SYSTEM = `You are a browser automation agent. You control a web browser via accessibility tree snapshots.
Given a task and a page snapshot, respond with ONE of these JSON actions:
- {"action":"click","ref":"@eN"}  — Click element by ref
- {"action":"fill","ref":"@eN","value":"text"} — Fill input
- {"action":"press","key":"Enter"} — Press key
- {"action":"scroll","direction":"down","amount":500}
- {"action":"navigate","url":"https://..."}
- {"action":"done","result":"summary"} — Task complete
- {"action":"stuck","reason":"why"} — Cannot proceed
Respond with JSON only. No explanation.`;

async function browserAgentLoop(task, maxSteps = 20) {
    const steps = [];

    // Start: open a blank page so snapshot works
    try { runAgentBrowser('open', 'about:blank'); } catch {}

    let messages = [
        { role: 'system', content: BROWSER_AGENT_SYSTEM },
        { role: 'user', content: `Task: ${task}\n\nRespond with your first action as JSON.` },
    ];

    for (let step = 0; step < maxSteps; step++) {
        // Snapshot the page
        let pageContext;
        try {
            const snap = runAgentBrowser('snapshot');
            const data = snap.data || snap;
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            const tree = parsed.tree || parsed.snapshot || JSON.stringify(parsed);
            const url = parsed.url || 'unknown';
            pageContext = `URL: ${url}\n${tree}`;
        } catch {
            pageContext = 'Could not get page snapshot.';
        }

        if (pageContext.length > 5000) pageContext = pageContext.slice(0, 5000) + '... (truncated)';
        messages.push({ role: 'user', content: `Current page:\n${pageContext}` });

        // Ask Gemini Nano
        const response = await promptChrome(
            convertMessages(messages), 0.3
        );
        messages.push({ role: 'assistant', content: response });

        // Parse action
        let action;
        try {
            const start = response.indexOf('{');
            const end = response.lastIndexOf('}') + 1;
            action = JSON.parse(response.slice(start, end));
        } catch {
            action = { action: 'stuck', reason: `Could not parse: ${response.slice(0, 200)}` };
        }

        steps.push({ step, action, response: response.slice(0, 200) });

        // Execute action
        const act = action.action;
        if (act === 'done') {
            return { completed: true, result: action.result, steps };
        }
        if (act === 'stuck') {
            return { completed: false, reason: action.reason, steps };
        }
        if (act === 'click') {
            runAgentBrowser('click', action.ref || '');
            await sleep(1000);
        } else if (act === 'fill') {
            runAgentBrowser('fill', action.ref || '', action.value || '');
            await sleep(500);
        } else if (act === 'press') {
            runAgentBrowser('press', action.key || 'Enter');
            await sleep(1000);
        } else if (act === 'scroll') {
            runAgentBrowser('scroll', action.direction || 'down', String(action.amount || 500));
            await sleep(500);
        } else if (act === 'navigate') {
            runAgentBrowser('open', action.url || '');
            await sleep(2000);
        }

        // Trim history
        if (messages.length > 14) {
            messages = [messages[0], ...messages.slice(-12)];
        }
    }

    return { completed: false, reason: 'Max steps reached', steps };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════
// Start Server
// ══════════════════════════════════════════════════════════

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  Gemini Nano Local API Bridge                       ║
║                                                      ║
║  HTTP API:   http://localhost:${PORT}/v1              ║
║  WebSocket:  ws://localhost:${PORT}/ws               ║
║  Health:     http://localhost:${PORT}/health          ║
║                                                      ║
║  OpenAI-compatible endpoint:                         ║
║  POST http://localhost:${PORT}/v1/chat/completions  ║
║                                                      ║
║  Image analysis:                                     ║
║  POST http://localhost:${PORT}/v1/analyze-image     ║
║                                                      ║
║  Built-in AI APIs:                                   ║
║  POST /v1/summarize                                  ║
║  POST /v1/translate                                  ║
║  POST /v1/detect-language                            ║
║                                                      ║
║  Browser Control (agent-browser):                    ║
║  POST /v1/browser/open     - Navigate to URL         ║
║  POST /v1/browser/snapshot - Get accessibility tree  ║
║  POST /v1/browser/click    - Click element by ref    ║
║  POST /v1/browser/fill    - Fill input by ref        ║
║  POST /v1/browser/press   - Press keyboard key       ║
║  POST /v1/browser/scroll  - Scroll page              ║
║  POST /v1/browser/close   - Close browser session    ║
║  POST /v1/browser/agent   - Run autonomous task       ║
║                                                      ║
║  Waiting for Chrome extension to connect via WS...   ║
╚══════════════════════════════════════════════════════╝`);
});
