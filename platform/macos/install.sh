#!/usr/bin/env bash
# Install the Notionize LaunchAgent (starts at login, like `tailscale` on boot).
set -euo pipefail

BIN="$(command -v notionize || echo "$HOME/.cargo/bin/notionize")"
LOG="$HOME/Library/Logs"; mkdir -p "$LOG"
DEST="$HOME/Library/LaunchAgents/com.notionize.daemon.plist"

sed -e "s|__BIN__|$BIN|g" -e "s|__LOG__|$LOG|g" \
    "$(dirname "$0")/com.notionize.daemon.plist" > "$DEST"

launchctl unload "$DEST" 2>/dev/null || true
launchctl load -w "$DEST"
echo "installed and started: $DEST"
