---
name: service-install
description: Install, debug, or version the always-on boot service (launchd on macOS, systemd on Linux). Use when making Notionize start on boot or fixing a service that will not stay up.
---

# Boot service (per-OS)

Notionize runs 24/7 like `tailscaled`: starts on boot, invisible, driven by the CLI.
OS specifics are versioned separately under `platform/`.

## macOS (launchd, per-user agent)

- `platform/macos/install.sh` templates `com.notionize.daemon.plist` into
  `~/Library/LaunchAgents/` and `launchctl load -w`s it. Per-user so it can reach the
  login keychain.
- Debug: `launchctl list | grep notionize`, then the log paths in the plist.

## Linux (systemd, user unit)

- `platform/linux/install.sh` copies `notionize.service` to `~/.config/systemd/user/` and
  runs `systemctl --user enable --now notionize`.
- Debug: `systemctl --user status notionize`, `journalctl --user -u notionize`.

## Rules

- Persistent state in `~/.notionize` so reboots reconnect without re-login.
- "Daemon running" ≠ "ready" — verify the HTTP health endpoint separately.
- Adding another OS = a new `platform/<os>/` folder, never `#[cfg]` sprawl in the binary.
