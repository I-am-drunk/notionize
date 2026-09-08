#!/usr/bin/env bash
# Install + enable the Notionize systemd user service.
set -euo pipefail
DEST="$HOME/.config/systemd/user"; mkdir -p "$DEST"
cp "$(dirname "$0")/notionize.service" "$DEST/notionize.service"
systemctl --user daemon-reload
systemctl --user enable --now notionize
echo "installed and started (systemctl --user status notionize)"
