// Gemini Nano Assistant — Background Service Worker v5
// Fresh session per request + keepalive + error recovery

let bridgeWs = null;
let isConnecting = false;
const BRIDGE_URL = 'ws://localhost:8765/ws';

// ── Keep service worker alive ──
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepalive' && isConnected()) {
        sendToBridge('ping', { type: 'ping' });
    }
    if (alarm.name === 'keepalive' && !isConnected() && !isConnecting) {
        connectToBridge();
    }
});

function isConnected() {
    return bridgeWs && bridgeWs.readyState === WebSocket.OPEN;
}

// ── Bridge Connection ──
function connectToBridge() {
    if (isConnected() || isConnecting) return;
    isConnecting = true;

    try {
        bridgeWs = new WebSocket(BRIDGE_URL);

        bridgeWs.onopen = () => {
            isConnecting = false;
            console.log('[BG] Connected to bridge');
            bridgeWs.send(JSON.stringify({ type: 'register', role: 'gemini-nano-bridge' }));
        };

        bridgeWs.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                await handleBridgeMessage(msg);
            } catch (e) {
                console.error('[BG] Message error:', e);
            }
        };

        bridgeWs.onclose = () => {
            isConnecting = false;
            console.log('[BG] Bridge disconnected');
        };

        bridgeWs.onerror = (e) => {
            isConnecting = false;
            console.error('[BG] Bridge error:', e.message);
        };
    } catch (e) {
        isConnecting = false;
        console.error('[BG] Connect failed:', e);
    }
}

// ── Handle messages from bridge ──
async function handleBridgeMessage(msg) {
    const { id, type } = msg;
    if (type === 'ping') return;

    try {
        let result;

        switch (type) {
            case 'prompt':
            case 'prompt-stream':
                result = await handlePrompt(msg.prompt, msg.temperature);
                break;

            case 'analyze-image':
                result = await handleImageAnalysis(msg.image, msg.prompt);
                break;

            case 'screenshot-analyze':
                result = await handleScreenshotAnalyze(msg.tabId, msg.prompt);
                break;

            default:
                sendToBridge(id, { error: `Unknown type: ${type}` });
                return;
        }

        sendToBridge(id, { result });

    } catch (err) {
        console.error('[BG] Handler error:', err);
        sendToBridge(id, { error: err.message });
    }
}

function sendToBridge(id, payload) {
    if (!isConnected()) {
        console.warn('[BG] Cannot send — bridge not connected');
        return;
    }
    try {
        bridgeWs.send(JSON.stringify({ id, ...payload }));
    } catch (e) {
        console.error('[BG] Send error:', e);
    }
}

// ── Gemini Nano Prompt (fresh session per request) ──
async function handlePrompt(prompt, temperature = 0.7) {
    let s = null;
    try {
        // Check availability first
        const avail = await LanguageModel.availability();
        if (avail === 'unavailable') {
            throw new Error('LanguageModel unavailable — enable chrome://flags/#optimization-guide-on-device-model');
        }
        if (avail === 'downloadable') {
            throw new Error('LanguageModel not yet downloaded — visit chrome://on-device-internals/ to trigger download');
        }

        // Create fresh session for each request (reuse causes hangs)
        s = await LanguageModel.create({
            temperature,
            topK: 40,
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
        });

        const result = await s.prompt(prompt);
        return result;

    } catch (err) {
        console.error('[BG] Prompt error:', err);
        throw err;
    } finally {
        // Always destroy session to free resources
        if (s) {
            try { s.destroy(); } catch (e) { /* ignore */ }
        }
    }
}

// ── Image Analysis (fresh session) ──
async function handleImageAnalysis(imageBase64, prompt) {
    let s = null;
    try {
        s = await LanguageModel.create({
            expectedInputs: [
                { type: 'text', languages: ['en'] },
                { type: 'image' },
            ],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
        });

        const binaryStr = atob(imageBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'image/png' });

        const result = await s.prompt([{
            role: 'user',
            content: [
                { type: 'text', value: prompt },
                { type: 'image', value: blob }
            ]
        }]);

        return result;
    } catch (err) {
        console.error('[BG] Image analysis error:', err);
        throw err;
    } finally {
        if (s) {
            try { s.destroy(); } catch (e) { /* ignore */ }
        }
    }
}

// ── Screenshot + Analyze ──
async function handleScreenshotAnalyze(tabId, prompt) {
    const dataUrl = await captureScreenshot(tabId);
    if (!dataUrl) throw new Error('Failed to capture screenshot');
    const base64 = dataUrl.split(',')[1];
    return await handleImageAnalysis(base64, prompt);
}

async function captureScreenshot(tabId) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTabId = tabId || tab.id;
        const results = await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: () => document.title + ' | ' + document.body.innerText.substring(0, 2000)
        });
        return results?.[0]?.result || null;
    } catch (e) {
        console.error('[BG] Screenshot error:', e);
        return null;
    }
}

// ── Side Panel ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-sidepanel') {
        chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    }
});

// ── Initialize ──
connectToBridge();
console.log('[BG] Gemini Nano bridge started (v5 — fresh sessions)');
