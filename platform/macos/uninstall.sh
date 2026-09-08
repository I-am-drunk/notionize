#!/usr/bin/env bash
set -euo pipefail
DEST="$HOME/Library/LaunchAgents/com.notionize.daemon.plist"
launchctl unload "$DEST" 2>/dev/null || true
rm -f "$DEST"
echo "uninstalled: $DEST"
