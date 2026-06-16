import http from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const pending = new Map();
let chromeWs = null;

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('[BRIDGE] Extension connected');
    chromeWs = ws;
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            const msgType = msg.type;
            const msgId = msg.id ? msg.id.substring(0, 8) : 'none';
            console.log('[BRIDGE] Got msg type=' + msgType + ' id=' + msgId);
            if (msg.id && pending.has(msg.id)) {
                console.log('[BRIDGE] Resolving pending request');
                pending.get(msg.id)(msg);
                pending.delete(msg.id);
            } else {
                console.log('[BRIDGE] No pending match for id');
            }
        } catch(e) { console.error('[BRIDGE] Parse error:', e); }
    });
    ws.on('close', () => { console.log('[BRIDGE] Extension disconnected'); chromeWs = null; });
});

function sendToChrome(type, payload, timeout = 30000) {
    return new Promise((resolve, reject) => {
        if (!chromeWs || chromeWs.readyState !== 1) {
            return reject(new Error('Extension not connected'));
        }
        const id = randomUUID();
        console.log('[BRIDGE] Sending type=' + type + ' id=' + id.substring(0, 8));
        const timer = setTimeout(() => {
            pending.delete(id);
            console.log('[BRIDGE] TIMEOUT after ' + timeout + 'ms');
            reject(new Error('Timeout after ' + timeout + 'ms'));
        }, timeout);
        pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
        chromeWs.send(JSON.stringify({ id, type, ...payload }));
    });
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.post('/v1/chat/completions', async (req, res) => {
    const { messages } = req.body;
    const prompt = messages.map(m => m.content).join(' ');
    console.log('[BRIDGE] Got completion request, prompt_length=' + prompt.length);
    try {
        const result = await sendToChrome('prompt', { prompt, temperature: 0.7 }, 30000);
        console.log('[BRIDGE] Got response, hasError=' + !!result.error);
        if (result.error) return res.status(500).json({ error: result.error });
        res.json({ choices: [{ message: { content: result.result } }] });
    } catch (e) {
        console.log('[BRIDGE] Request failed: ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

server.listen(8765, () => console.log('[BRIDGE] Debug bridge listening on 8765'));
