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
        // Data comes wrapped in text field from bridge's builtInApi
        const imageData = typeof msg.text === 'object' ? msg.text.image : msg.image;
        const promptData = typeof msg.text === 'object' ? msg.text.prompt : msg.prompt;
        result = await handleImageAnalysis(imageData, promptData);
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

      // ── WebMCP ──
      case 'webmcp-discover':
        result = await handleWebMcpDiscover(msg.tabId);
        break;

      case 'webmcp-call':
        result = await handleWebMcpCall(msg.tabId, msg.toolName, msg.args);
        break;

      case 'webmcp-register':
        result = await handleWebMcpRegister(msg.tabId, msg.tools);
        break;

      // ── Agent Loop ──
      case 'agent-start':
        result = await handleAgentStart(msg);
        break;

      case 'agent-step':
        result = await handleAgentStep(msg);
        break;

      case 'agent-stop':
        result = await handleAgentStop(msg);
        break;

      case 'agent-status':
        result = await handleAgentStatus(msg);
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

// Call bridge's chat completions via WebSocket (for agent loop)
async function promptBridge(prompt, temperature = 0.3) {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      return reject(new Error('Bridge not connected'));
    }
    
    const id = 'agent_prompt_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Timeout waiting for bridge prompt response'));
    }, 180000);

    pendingRequests.set(id, {
      resolve: (msg) => { clearTimeout(timer); resolve(msg.result); },
      reject: (err) => { clearTimeout(timer); reject(err); }
    });

    bridgeWs.send(JSON.stringify({ id, type: 'prompt', prompt, temperature }));
  });

// Convert messages to prompt string (for bridge)
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

    const result = await session.prompt(prompt, { outputLanguage: 'en' });
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

    const result = await session.prompt(
      [
        {
          role: 'user',
          content: [
            { type: 'text', value: prompt },
            { type: 'image', value: blob },
          ],
        },
      ],
      { outputLanguage: 'en' }
    );

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

// ── WebMCP Handlers ──
async function handleWebMcpDiscover(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check if WebMCP is available and tools are registered
        return {
          webmcpAvailable: typeof navigator.webMCP !== 'undefined',
          toolsRegistered: typeof window.WEBMCP_TOOLS !== 'undefined'
            ? window.WEBMCP_TOOLS.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters
              }))
            : []
        };
      }
    });
    return results?.[0]?.result || { webmcpAvailable: false, toolsRegistered: [] };
  } catch (e) {
    console.error('[BG] WebMCP discover error:', e);
    return { webmcpAvailable: false, toolsRegistered: [], error: e.message };
  }
}

async function handleWebMcpCall(tabId, toolName, args) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (toolName, args) => {
        return new Promise((resolve, reject) => {
          const requestId = 'webmcp_' + Date.now() + '_' + Math.random().toString(36).slice(2);

          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'WEBMCP_RESULT' && event.data.requestId === requestId) {
              window.removeEventListener('message', handler);
              if (event.data.error) reject(new Error(event.data.error));
              else resolve(event.data.result);
            }
          };
          window.addEventListener('message', handler);

          // Timeout after 30s
          setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('WebMCP call timeout'));
          }, 30000);

          window.postMessage(
            { type: 'WEBMCP_CALL', toolName, args, requestId },
            '*'
          );
        });
      },
      args: [toolName, args]
    });
    return results?.[0]?.result;
  } catch (e) {
    console.error('[BG] WebMCP call error:', e);
    throw new Error('WebMCP call failed: ' + e.message);
  }
}

async function handleWebMcpRegister(tabId, tools) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (tools) => {
        if (typeof navigator.webMCP !== 'undefined' && navigator.webMCP.registerTools) {
          return navigator.webMCP.registerTools(tools);
        }
        throw new Error('WebMCP not available');
      },
      args: [tools]
    });
    return { ok: true };
  } catch (e) {
    console.error('[BG] WebMCP register error:', e);
    throw new Error('WebMCP register failed: ' + e.message);
  }
}

// ── Extension-Side Agent Loop ──
const agentState = new Map(); // sessionId -> { task, status, messages, step, maxSteps, session }

const AGENT_SYSTEM = `You are a browser automation agent running inside a Chrome extension. You control a web browser via agent-browser and WebMCP tools.

AVAILABLE ACTIONS (respond with JSON only):
- {"action": "click", "ref": "@eN"}        — Click element by accessibility ref
- {"action": "fill", "ref": "@eN", "value": "text"} — Clear and fill an input
- {"action": "type", "ref": "@eN", "value": "text"}  — Type into input (append)
- {"action": "press", "key": "Enter"}       — Press a keyboard key
- {"action": "scroll", "direction": "down", "amount": 500} — Scroll page
- {"action": "navigate", "url": "https://..."} — Go to URL
- {"action": "webmcp", "tool": "name", "args": {...}} — Call a WebMCP tool on the page
- {"action": "screenshot", "annotate": true}   — Take annotated screenshot
- {"action": "vision", "prompt": "desc", "image": "base64"} — Analyze image
- {"action": "done", "result": "summary"}   — Task is complete
- {"action": "stuck", "reason": "why"}      — Cannot proceed

RULES:
1. Always respond with valid JSON matching one of the actions above
2. Use refs from accessibility tree (e.g., @e3, @e12)
3. WebMCP tools are semantic — prefer over raw clicks
4. VISION: screenshot → vision with base64 from screenshot
5. After each action, you'll see updated page state
6. If page needs loading, just say done for this step
7. If can't find element, try scrolling
8. Be concise — just JSON action, no explanation`;

async function runAgentStep(sessionId) {
  const state = agentState.get(sessionId);
  if (!state || state.status !== 'running') return { status: 'not-running' };

  const { task, maxSteps, session, messages, step } = state;
  if (step >= maxSteps) {
    agentState.set(sessionId, { ...state, status: 'done', result: 'Max steps reached' });
    return { status: 'done', result: 'Max steps reached', steps: step };
  }

  try {
    // Get page snapshot
    let pageContext = 'No page';
    try {
      const snap = await runAgentBrowser('snapshot');
      const data = snap.data || snap;
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const tree = parsed.tree || parsed.snapshot || JSON.stringify(parsed);
      const url = parsed.url || 'unknown';
      pageContext = `URL: ${url}\n${tree}`;
    } catch (e) {
      pageContext = 'Could not get snapshot: ' + e.message;
    }

    if (pageContext.length > 5000) pageContext = pageContext.slice(0, 5000) + '... (truncated)';
    messages.push({ role: 'user', content: `Current page:\n${pageContext}` });

    // Ask Gemini Nano via bridge
    const response = await promptBridge(convertMessages(messages), 0.3);
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

    // Execute action
    let result = 'ok';
    const act = action.action;
    if (act === 'done') {
      agentState.set(sessionId, { ...state, status: 'done', result: action.result });
      return { status: 'done', result: action.result, steps: step + 1 };
    }
    if (act === 'stuck') {
      agentState.set(sessionId, { ...state, status: 'stuck', reason: action.reason });
      return { status: 'stuck', reason: action.reason, steps: step + 1 };
    }
    if (act === 'click') {
      await runAgentBrowser('click', action.ref || '');
      await sleep(1000);
    } else if (act === 'fill') {
      await runAgentBrowser('fill', action.ref || '', action.value || '');
      await sleep(500);
    } else if (act === 'press') {
      await runAgentBrowser('press', action.key || 'Enter');
      await sleep(1000);
    } else if (act === 'scroll') {
      await runAgentBrowser('scroll', action.direction || 'down', String(action.amount || 500));
      await sleep(500);
    } else if (act === 'navigate') {
      await runAgentBrowser('open', action.url || '');
      await sleep(2000);
    } else if (act === 'webmcp') {
      await runAgentBrowser('webmcp', action.tool, JSON.stringify(action.args || {}));
      await sleep(1500);
    } else if (act === 'screenshot') {
      const shot = await runAgentBrowser('screenshot', '--annotate');
      state.lastScreenshot = shot;
      await sleep(1000);
    } else if (act === 'vision') {
      if (!action.image && !state.lastScreenshot) {
        result = 'no image available';
      } else {
        const img = action.image || state.lastScreenshot?.base64 || state.lastScreenshot?.data;
        if (img) {
          result = await builtInApi('analyze-image', { image: img, prompt: action.prompt });
          await sleep(1500);
        } else {
          result = 'no image data';
        }
      }
    }

    // Include action result in messages
    messages.push({ role: 'user', content: `Action result: ${JSON.stringify(result).slice(0, 1000)}` });

    // Trim history
    if (messages.length > 14) {
      messages.splice(1, messages.length - 11);
    }

    state.step = step + 1;
    agentState.set(sessionId, { ...state, messages, step: step + 1 });

    return { 
      status: 'running', 
      step: step + 1, 
      action, 
      actionResult: result,
      pageUrl: pageContext.split('\n')[0]?.replace('URL: ', '') 
    };
  } catch (err) {
    console.error('[BG] Agent step error:', err);
    agentState.set(sessionId, { ...state, status: 'error', error: err.message });
    return { status: 'error', error: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Agent Loop Bridge Handlers ──
async function handleAgentStart(msg) {
  const { task, maxSteps = 20, sessionId = 'agent_' + Date.now() } = msg;
  
  // Initialize agent state
  const initialMessages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: `Task: ${task}\n\nRespond with your first action as JSON.` }
  ];

  agentState.set(sessionId, {
    task,
    maxSteps,
    status: 'running',
    messages: initialMessages,
    step: 0,
    sessionId,
    lastScreenshot: null
  });

  // Run first step
  const result = await runAgentStep(sessionId);
  return { sessionId, ...result };
}

async function handleAgentStep({ sessionId }) {
  return await runAgentStep(sessionId);
}

async function handleAgentStop({ sessionId }) {
  const state = agentState.get(sessionId);
  if (state) {
    agentState.set(sessionId, { ...state, status: 'stopped' });
    // Cleanup browser
    try { await runAgentBrowser('close', '--all'); } catch {}
  }
  return { ok: true };
}

async function handleAgentStatus({ sessionId }) {
  const state = agentState.get(sessionId);
  if (!state) return { status: 'not-found' };
  return { 
    sessionId: state.sessionId,
    status: state.status,
    step: state.step,
    maxSteps: state.maxSteps,
    task: state.task,
    result: state.result,
    error: state.error,
    reason: state.reason,
    lastAction: state.messages[state.messages.length - 1]?.content?.slice(0, 200)
  };
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
