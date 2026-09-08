#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now notionize 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/notionize.service"
systemctl --user daemon-reload
echo "uninstalled"
