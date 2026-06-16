#!/bin/bash
# Gemini Nano Agent — Setup Script
# Installs dependencies and configures everything

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Gemini Nano Agent Setup                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 1. Install bridge dependencies
echo "[1/4] Installing bridge dependencies..."
cd "$DIR/bridge"
npm install 2>/dev/null || npm install --prefix "$DIR/bridge"
echo "  ✅ Bridge deps installed"

# 2. Install agent dependencies
echo "[2/4] Installing agent dependencies..."
pip3 install websockets httpx 2>/dev/null || echo "  ⚠️  Install manually: pip3 install websockets httpx"
echo "  ✅ Agent deps installed"

# 3. Create launch script
echo "[3/4] Creating launch scripts..."
cat > "$DIR/start.sh" << 'LAUNCH'
#!/bin/bash
# Start the Gemini Nano Agent stack

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Gemini Nano Agent stack..."
echo ""

# Check if Chrome is running with CDP
if ! curl -s http://localhost:9222/json > /dev/null 2>&1; then
    echo "⚠️  Chrome CDP not detected."
    echo "   Start Chrome with:"
    echo "   google-chrome --remote-debugging-port=9222 &"
    echo ""
    echo "   Or on this display:"
    echo "   google-chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 &"
    echo ""
fi

# Start bridge in background
echo "[1/2] Starting API bridge on port 8765..."
cd "$DIR/bridge"
node server.js &
BRIDGE_PID=$!
sleep 2

# Check bridge
if curl -s http://localhost:8765/health > /dev/null 2>&1; then
    echo "  ✅ Bridge running (PID: $BRIDGE_PID)"
else
    echo "  ❌ Bridge failed to start"
    kill $BRIDGE_PID 2>/dev/null
    exit 1
fi

echo ""
echo "[2/2] Ready! Use the agent:"
echo "  cd $DIR/agent"
echo "  python3 agent.py 'Go to github.com and find trending Python repos'"
echo "  python3 agent.py --interactive"
echo ""
echo "  Or just open the Chrome extension: Ctrl+Shift+G"
echo ""
echo "  Bridge API: http://localhost:8765/v1"
echo "  WebSocket:  ws://localhost:8765/ws"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Wait for bridge
wait $BRIDGE_PID
LAUNCH
chmod +x "$DIR/start.sh"
echo "  ✅ start.sh created"

# 4. Create Chrome launch helper
cat > "$DIR/start-chrome.sh" << 'CHROME'
#!/bin/bash
# Launch Chrome with remote debugging for Browser Harness

echo "Launching Chrome with CDP enabled..."
echo "The bridge will connect automatically."
echo ""

google-chrome \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --no-first-run \
    --disable-default-apps \
    "$@" &
CHROME
chmod +x "$DIR/start-chrome.sh"
echo "  ✅ start-chrome.sh created"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Setup Complete!                                 ║"
echo "║                                                  ║"
echo "║  Quick start:                                    ║"
echo "║    1. ./start-chrome.sh                          ║"
echo "║    2. Load extension in chrome://extensions/     ║"
echo "║    3. ./start.sh                                 ║"
echo "║    4. python3 agent/task.py 'your task'          ║"
echo "╚══════════════════════════════════════════════════╝"
