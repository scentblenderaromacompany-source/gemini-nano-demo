// Gemini Nano Assistant — Background Service Worker v5
// Bulletproof WebSocket + fresh session per request + built-in AI APIs

let bridgeWs = null;
let isConnecting = false;
let reconnectTimer = null;

const BRIDGE_URL = 'ws://localhost:8765/ws';

const connectBackoffMs = [1000, 2000, 4000, 8000, 16000, 16000];
let nextConnectIndex = 0;

function isConnected() {
  return (
    typeof bridgeWs !== 'undefined' &&
    bridgeWs !== null &&
    bridgeWs.readyState === WebSocket.OPEN
  );
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = connectBackoffMs[nextConnectIndex] || 16000;
  nextConnectIndex = Math.min(nextConnectIndex + 1, connectBackoffMs.length - 1);
  console.log(`[BG] Reconnecting in ${delay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToBridge();
  }, delay);
}

function connectToBridge() {
  if (isConnected() || isConnecting) {
    return;
  }
  isConnecting = true;

  try {
    bridgeWs = new WebSocket(BRIDGE_URL);

    bridgeWs.onopen = () => {
      isConnecting = false;
      nextConnectIndex = 0;
      console.log('[BG] Connected to bridge');
      bridgeWs.send(
        JSON.stringify({ type: 'register', role: 'gemini-nano-bridge' }),
      );
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
      scheduleReconnect();
    };

    bridgeWs.onerror = (e) => {
      isConnecting = false;
      console.error('[BG] Bridge error', e);
      scheduleReconnect();
    };
  } catch (e) {
    isConnecting = false;
    console.error('[BG] Connect failed:', e);
    scheduleReconnect();
  }
}

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && isConnected()) {
    sendToBridge('ping', { type: 'ping' });
  }
  if (alarm.name === 'keepalive' && !isConnected() && !isConnecting) {
    connectToBridge();
  }
});

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

      case 'summarize':
        result = await handleSummarize(msg.text, msg.type);
        break;

      case 'translate':
        result = await handleTranslate(msg.text, msg.targetLanguage);
        break;

      case 'detect-language':
        result = await handleDetectLanguage(msg.text);
        break;

      default:
        sendToBridge(id, { error: 'Unknown type: ' + type });
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
async function handlePrompt(prompt, temperature) {
  temperature = temperature ?? 0.7;
  let session = null;
  try {
    if (typeof LanguageModel === 'undefined') {
      throw new Error(
        'LanguageModel API not defined. Enable chrome://flags/#optimization-guide-on-device-model',
      );
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error(
        'LanguageModel unavailable — enable chrome://flags/#optimization-guide-on-device-model',
      );
    }
    if (availability === 'downloadable') {
      throw new Error('LanguageModel not yet downloaded');
    }

    session = await LanguageModel.create({
      temperature,
      topK: 40,
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });

    const result = await session.prompt(prompt);
    return result;
  } catch (err) {
    console.error('[BG] Prompt error:', err);
    throw err;
  } finally {
    if (session) {
      try {
        await session.destroy();
      } catch (_) {
        // ignore teardown errors
      }
    }
  }
}

// ── Image Analysis (fresh session) ──
async function handleImageAnalysis(imageBase64, prompt) {
  let session = null;
  try {
    session = await LanguageModel.create({
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

    const result = await session.prompt([
      {
        role: 'user',
        content: [
          { type: 'text', value: prompt },
          { type: 'image', value: blob },
        ],
      },
    ]);

    return result;
  } catch (err) {
    console.error('[BG] Image analysis error:', err);
    throw err;
  } finally {
    if (session) {
      try {
        await session.destroy();
      } catch (_) {
        // ignore
      }
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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const targetTabId = tabId || tab.id;
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => document.title,
    });
    return results && results[0] ? results[0].result : null;
  } catch (e) {
    console.error('[BG] Screenshot error:', e);
    return null;
  }
}

// ── Built-in Chrome AI APIs ──
async function handleSummarize(text, summaryType) {
  try {
    const summarizer = await Summarizer.create({
      type: summaryType || 'key-points',
      format: 'plain-text',
      length: 'medium',
    });
    return await summarizer.summarize(text);
  } catch (err) {
    console.error('[BG] Summarizer error:', err);
    throw new Error('Summarizer API unavailable: ' + err.message);
  }
}

async function handleTranslate(text, targetLanguage) {
  try {
    const translator = await Translator.create({
      sourceLanguage: null,
      targetLanguage: targetLanguage || 'es',
    });
    return await translator.translate(text);
  } catch (err) {
    console.error('[BG] Translator error:', err);
    throw new Error('Translator API unavailable: ' + err.message);
  }
}

async function handleDetectLanguage(text) {
  try {
    const detector = await LanguageDetector.create();
    const result = await detector.detect(text);
    return JSON.stringify(result);
  } catch (err) {
    console.error('[BG] LanguageDetector error:', err);
    throw new Error('LanguageDetector API unavailable: ' + err.message);
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
console.log(
  '[BG] Gemini Nano bridge started (v5 — fresh sessions + built-in APIs)',
);
