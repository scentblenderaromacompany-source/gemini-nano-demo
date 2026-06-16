# Gemini Nano Browser Agent

Autonomous browser agent powered by Chrome's on-device Gemini Nano model.
Uses [agent-browser](https://github.com/vercel-labs/agent-browser) for browser control and the Gemini Nano bridge for reasoning.

## Architecture

```
Task → Agent Loop → agent-browser snapshot → Gemini Nano decides → agent-browser acts → repeat
```

- **Brain**: Gemini Nano (free, on-device, via bridge at localhost:8765)
- **Hands**: agent-browser (own Chromium instance, accessibility tree refs)

## Prerequisites

1. Bridge server running: `cd ~/gemini-nano-demo/bridge && node server.js`
2. Chrome extension loaded with Gemini Nano enabled
3. agent-browser installed: `npm install -g agent-browser && agent-browser install`

## Usage

### Python
```bash
python3 agent/agent.py "Find trending AI repos on GitHub"
python3 agent/agent.py "Search Wikipedia for quantum computing" --headed
python3 agent/agent.py "Go to hackernews and find top story" --max-steps 10
```

### Node.js
```bash
node agent/agent.js "Find trending AI repos on GitHub"
node agent/agent.js "Search Wikipedia for quantum computing" --headed
node agent/agent.js "Go to hackernews and find top story" --max-steps 10
```

## Agent Actions

The agent can perform these actions (returned as JSON by Gemini Nano):

| Action | JSON | Description |
|---|---|---|
| Click | `{"action":"click","ref":"@e3"}` | Click element by accessibility ref |
| Fill | `{"action":"fill","ref":"@e5","value":"text"}` | Clear and fill input |
| Type | `{"action":"type","ref":"@e5","value":"text"}` | Append text to input |
| Press | `{"action":"press","key":"Enter"}` | Press keyboard key |
| Scroll | `{"action":"scroll","direction":"down","amount":500}` | Scroll page |
| Navigate | `{"action":"navigate","url":"https://..."}` | Go to URL |
| Done | `{"action":"done","result":"summary"}` | Task complete |
| Stuck | `{"action":"stuck","reason":"why"}` | Cannot proceed |

## How It Works

1. `agent-browser snapshot` captures the page's accessibility tree with ref IDs
2. The snapshot is sent to Gemini Nano with the task context
3. Gemini Nano responds with a JSON action
4. The agent executes the action via agent-browser
5. Loop repeats until `done` or `stuck` or max steps reached

## Flags

- `--headed` — Show browser window (default: headless)
- `--max-steps N` — Max agent steps before stopping (default: 20)
