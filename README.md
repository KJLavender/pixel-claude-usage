# Pixel Claude Usage

**English** | [繁體中文](README.zh-TW.md)

A small pixel-style panel that shows how much of your Claude plan you've used, on your phone.

It runs a tiny server on your computer. The server reads the login that Claude Code already saved on that computer, asks Anthropic for your current usage, and serves a phone-sized page. You open the page on your phone and add it to your home screen, so it works like a widget-style app.

What it shows:

- **5H SESSION**: how much of the current 5-hour limit you've used, and when it resets
- **WEEKLY**: how much of the weekly limit you've used, and when it resets
- Per-model weekly limits, if your plan has them
- **TODAY**: tokens used today, counted from Claude Code's local logs on this computer
- **7D MIX**: where your weekly usage went (Claude Code, chat, and so on)

## What you need

- Node.js 18 or newer
- Claude Code installed and logged in on this computer with a Claude subscription (Pro / Max). No API key needed.
- Your phone on the same Wi-Fi as the computer (see "Using it away from home" for other networks)

## Setup

1. Start the server:

   ```
   node server.mjs
   ```

   Or double-click `start.bat`. The first run creates `config.json` with a random key and the port (default 8790).

2. On the computer, open `http://localhost:8790/pair`. It shows a QR code.
3. Scan the QR code with your phone. The panel opens.
4. Add it to your home screen:
   - iPhone (Safari): Share → Add to Home Screen
   - Android (Chrome): ⋮ menu → Add to Home screen / Install app

The first time the server starts, Windows may ask whether to let Node.js through the firewall. Allow it on private networks, or the phone can't connect.

## Start it automatically

```
powershell -ExecutionPolicy Bypass -File install-autostart.ps1
```

This puts a small script in your Windows Startup folder, so the server starts hidden whenever you log in. Run it again with `-Remove` to undo.

## How it works

- Login: Claude Code saves its login in `.credentials.json` inside its config folder (`~/.claude`, or `CLAUDE_CONFIG_DIR` if set). The server reads that file and uses the freshest token. It never changes the file.
- Usage data comes from `https://api.anthropic.com/api/oauth/usage`, the same source Claude Code's `/usage` uses. This is not a documented public API, so it may change.
- The server asks Anthropic at most once a minute. The page refreshes every minute while open, and when you switch back to it.
- The TODAY numbers come from the conversation logs Claude Code writes under `~/.claude/projects`. They only cover Claude Code on this computer, not claude.ai chats or other devices.

## Using it away from home

By default the page only works on your home Wi-Fi. To open it from anywhere, use [Tailscale](https://tailscale.com/). It's a free app that links your own devices into a private network, so your phone can reach your computer from outside without opening the computer to the internet.

You only need to set it up once:

1. **Computer**: download the Windows version from https://tailscale.com/download, install it, and log in (Google, Microsoft, and others work).
2. **Phone**: install "Tailscale" from the App Store or Play Store, log in with the **same account**, and turn the VPN on.
3. **Find the computer's Tailscale IP**: click the Tailscale icon in the Windows taskbar. The IP starts with `100.`.
4. **On the phone**, open this address and add it to your home screen:

   ```
   http://100.x.x.x:8790/?k=<your key>
   ```

   The key is the `key` field in `config.json`. The server also prints it when it starts.

After that it works on home Wi-Fi and on mobile data, as long as:

- the computer is on and the server is running (`install-autostart.ps1` makes it start when you log in)
- Tailscale is on, on the phone

Notes:

- The first time the phone connects over Tailscale, Windows Firewall may ask again. Windows sometimes treats the Tailscale network as "public", so allow it there too, or the phone can't connect.
- Don't forward port 8790 on your router to the open internet. The key in the URL is only a light guard and won't stop someone who is really trying.

## Limits and known issues

- The login token from Claude Code expires after a few hours. Claude Code renews it when you use it. If you haven't opened Claude Code in a while, the panel shows "token expired" and keeps the last numbers until you open Claude Code again.
- The key in the URL is a simple guard against other people on the same Wi-Fi. Anyone who has the link can see your usage numbers (only the numbers, not your login).
- The page is a home-screen web app, not a native widget. It refreshes when you open it.

## Settings

`config.json` (created on first run, not committed):

| Field | Meaning |
| --- | --- |
| `port` | Server port, default 8790 |
| `key` | The key in the URL. Delete it and restart to make a new one |
| `extraConfigDirs` | Extra Claude Code config folders to look for logins in (optional) |

Environment variables `PORT` and `USAGE_KEY` override these.
