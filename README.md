# Pixel Claude Usage

**English** | [繁體中文](README.zh-TW.md)

A small pixel-style panel that shows how much of your Claude plan you've used, on your phone.

It runs a tiny server on your computer. The server reads the login that Claude Code already saved on that computer, asks Anthropic for your current usage, and serves a phone-sized page. You open the page on your phone and add it to your home screen, so it works like a widget-style app.

What it shows:

- **5H SESSION**: how much of the current 5-hour limit you've used, how much is left, and when it resets. Once the reset time passes it shows 0% and "reset" right away.
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

- Login: Claude Code saves its login in `.credentials.json` inside its config folder (`~/.claude`, or `CLAUDE_CONFIG_DIR` if set). The server reads that file and uses the freshest token. It never writes to the file itself.
- Keeping the login fresh: the login token expires after a few hours. A few minutes before that, the server runs Claude Code once with a one-word prompt on Haiku (the cheapest model). Claude Code renews its own login as part of that and saves it, so the panel keeps working even if you haven't opened Claude Code all day. This happens at most every 20 minutes, in practice a few times a day, and uses a tiny bit of your usage. Set `"autoRefresh": false` in `config.json` to turn it off.
- Why the server doesn't renew the token itself: the renewal code (refresh token) can only be used once. If the server used it, Claude Code's saved copy would stop working and you'd have to log in again. Letting Claude Code do it avoids that.
- Usage data comes from `https://api.anthropic.com/api/oauth/usage`, the same source Claude Code's `/usage` uses. This is not a documented public API, so it may change.
- The server checks usage every 5 minutes in the background, and at most once a minute when the page asks. The page refreshes every minute while open, and when you switch back to it.
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

### Other options

I've only tested this with the home Wi-Fi setup above. These are other common ways to do it, and I haven't tried them with this project:

- **ZeroTier** (https://www.zerotier.com/): works like Tailscale. Install it on both devices, join the same network, and use the computer's ZeroTier IP. A bit more setup than Tailscale.
- **Cloudflare Tunnel** (`cloudflared`): gives you a public https address without opening any ports, and doesn't need an app on the phone. The catch is that anyone who has the link can see your usage numbers, so keep the link to yourself. Running `cloudflared tunnel --url http://localhost:8790` gives you a temporary address that changes every time it restarts. A fixed address needs a Cloudflare account and your own domain.
- **Router port forwarding**: not recommended. It puts the page straight onto the internet, and the key in the URL is only a light guard.
- **Radmin VPN**: it only runs on Windows and has no phone app, so it doesn't work for this.

## Limits and known issues

- If the automatic renewal fails (for example, the computer was offline, or Claude Code's login itself has expired), the panel shows a message and keeps the last numbers. Opening Claude Code on the computer fixes it.
- The key in the URL is a simple guard against other people on the same Wi-Fi. Anyone who has the link can see your usage numbers (only the numbers, not your login).
- The page is a home-screen web app, not a native widget. It refreshes when you open it.

## Settings

`config.json` (created on first run, not committed):

| Field | Meaning |
| --- | --- |
| `port` | Server port, default 8790 |
| `key` | The key in the URL. Delete it and restart to make a new one |
| `extraConfigDirs` | Extra Claude Code config folders to look for logins in (optional) |
| `autoRefresh` | `false` turns off the automatic login renewal (default on) |
| `claudePath` | Full path to the `claude` program, if it isn't on PATH (optional) |

Environment variables `PORT` and `USAGE_KEY` override these.
