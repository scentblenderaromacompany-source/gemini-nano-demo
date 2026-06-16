// Gemini Nano Local API Bridge
// Exposes Chrome's Gemini Nano as an OpenAI-compatible HTTP API
// so tools like Browser Harness, LangChain, etc. can use it.

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

    // Convert OpenAI format to Gemini Nano format
    const prompt = convertMessages(messages);

    if (stream) {
        // SSE streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const completionId = `chatcmpl-${randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        // Send via WebSocket to Chrome extension
        const result = await streamToChrome(prompt, (chunk) => {
            const sseData = JSON.stringify({
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: 'gemini-nano',
                choices: [{
                    index: 0,
                    delta: { content: chunk },
                    finish_reason: null
                }]
            });
            res.write(`data: ${sseData}\n\n`);
        });

        // Send final chunk
        const finalData = JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: 'gemini-nano',
            choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop'
            }]
        });
        res.write(`data: ${finalData}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();

    } else {
        // Non-streaming response
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
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
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
        const result = await analyzeImageWithChrome(image, prompt);
        if (format === 'json') {
            try { res.json(JSON.parse(result)); }
            catch { res.json({ description: result }); }
        } else {
            res.json({ result });
        }
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

// ══════════════════════════════════════════════════════════
// Chrome Communication Layer
// ══════════════════════════════════════════════════════════

// Store pending requests
const pendingRequests = new Map();
let chromeWs = null;

// WebSocket server for Chrome extension to connect
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
        // Reject all pending requests
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

// Convert OpenAI messages format to simple prompt string
function convertMessages(messages) {
    // Extract system prompt and user messages
    let system = '';
    const userMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            system += msg.content + '\n\n';
        } else if (msg.role === 'user') {
            // Handle multimodal content
            if (Array.isArray(msg.content)) {
                const textParts = msg.content.filter(p => p.type === 'text').map(p => p.text);
                userMessages.push(textParts.join('\n'));
            } else {
                userMessages.push(msg.content);
            }
        } else if (msg.role === 'assistant') {
            // Include assistant history for context
            userMessages.push(`Assistant: ${msg.content}`);
        }
    }

    let prompt = '';
    if (system) prompt += `[System] ${system}\n`;
    prompt += userMessages.join('\n\n');
    return prompt;
}

// Prompt Chrome extension (non-streaming)
async function promptChrome(prompt, temperature = 0.7) {
    const response = await sendToChrome('prompt', { prompt, temperature }, 180000);
    if (response.error) throw new Error(response.error);
    return response.result;
}

// Stream from Chrome extension
async function streamToChrome(prompt, onChunk) {
    const response = await sendToChrome('prompt-stream', { prompt }, 60000);
    if (response.error) throw new Error(response.error);

    // For now, bridge returns full result (streaming would need chunked WebSocket)
    // We simulate streaming by chunking the response
    const text = response.result;
    const chunkSize = 20;
    for (let i = 0; i < text.length; i += chunkSize) {
        onChunk(text.substring(i, i + chunkSize));
        await new Promise(r => setTimeout(r, 10));
    }
}

// Analyze image via Chrome extension
async function analyzeImageWithChrome(imageBase64, prompt) {
    const response = await sendToChrome('analyze-image', { image: imageBase64, prompt }, 60000);
    if (response.error) throw new Error(response.error);
    return response.result;
}

// Screenshot + analyze
async function screenshotAndAnalyze(tabId, prompt) {
    const response = await sendToChrome('screenshot-analyze', { tabId, prompt }, 60000);
    if (response.error) throw new Error(response.error);
    return response.result;
}

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
║  Waiting for Chrome extension to connect via WS...   ║
╚══════════════════════════════════════════════════════╝
`);
});
