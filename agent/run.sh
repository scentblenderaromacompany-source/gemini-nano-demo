#!/bin/bash
# Run the Gemini Nano Browser Agent
# Usage: ./run.sh "Go to github.com and find trending Python repos"
#        ./run.sh --interactive

DIR="$(cd "$(dirname "$0")" && pwd)"

# Activate venv if it exists
if [ -f "$DIR/.venv/bin/activate" ]; then
    source "$DIR/.venv/bin/activate"
fi

exec python3 "$DIR/agent.py" "$@"
