#!/bin/bash
cd "$(dirname "$0")"
source .venv/bin/activate
python3 -u agent.py "$@" > /tmp/agent-output.log 2>&1
echo "EXIT:$?" >> /tmp/agent-output.log
