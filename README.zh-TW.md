# Pixel Claude Usage

[English](README.md) | **繁體中文**

一個像素風的小面板，讓你在手機上看自己的 Claude 方案用量用了多少。

它會在你的電腦上跑一個小伺服器。伺服器讀取 Claude Code 已經存在這台電腦上的登入資料，向 Anthropic 查目前的用量，再提供一個手機大小的網頁。你在手機上打開這個網頁、加到主畫面，用起來就像一個小工具 App。

畫面上會顯示：

- **5H SESSION**：目前這個 5 小時額度用了多少、什麼時候重置
- **WEEKLY**：本週額度用了多少、什麼時候重置
- 個別模型的每週額度（如果你的方案有的話）
- **TODAY**：今天用了多少 token，從這台電腦上 Claude Code 的本機紀錄算出來
- **7D MIX**：這週的用量花在哪裡（Claude Code、聊天等等）

## 需要什麼

- Node.js 18 以上
- 這台電腦上有裝 Claude Code，而且用 Claude 訂閱（Pro / Max）登入過。不需要 API key。
- 手機跟電腦連同一個 Wi-Fi（不在家要用的話看下面「出門也要看」）

## 安裝

1. 啟動伺服器：

   ```
   node server.mjs
   ```

   或直接雙擊 `start.bat`。第一次執行會建立 `config.json`，裡面有一組隨機金鑰和 port（預設 8790）。

2. 在電腦上打開 `http://localhost:8790/pair`，會出現 QR code。
3. 用手機掃 QR code，就會打開面板。
4. 加到主畫面：
   - iPhone（Safari）：分享 → 加入主畫面
   - Android（Chrome）：右上 ⋮ 選單 → 加到主畫面／安裝應用程式

第一次啟動時，Windows 可能會問要不要讓 Node.js 通過防火牆。選允許「私人網路」，不然手機連不進來。

## 開機自動啟動

```
powershell -ExecutionPolicy Bypass -File install-autostart.ps1
```

這會在 Windows 的「啟動」資料夾放一個小腳本，之後每次登入電腦，伺服器都會在背景自動啟動。加上 `-Remove` 再跑一次就會取消。

## 運作方式

- 登入資料：Claude Code 會把登入資料存在設定資料夾裡的 `.credentials.json`（`~/.claude`，有設 `CLAUDE_CONFIG_DIR` 的話就是那個資料夾）。伺服器只讀這個檔案、挑最新的 token 來用，不會修改它。
- 用量資料來自 `https://api.anthropic.com/api/oauth/usage`，跟 Claude Code 的 `/usage` 指令是同一個來源。這不是官方公開文件裡的 API，之後可能會變。
- 伺服器最多一分鐘問 Anthropic 一次。網頁開著時每分鐘更新一次，切回來的時候也會更新。
- TODAY 的數字來自 Claude Code 寫在 `~/.claude/projects` 底下的對話紀錄，只算這台電腦上的 Claude Code，不包含 claude.ai 網頁聊天或其他裝置。

## 出門也要看

預設只能在家裡的 Wi-Fi 用。想在外面也能看，可以用 [Tailscale](https://tailscale.com/)。它是一個免費的 App，會把你自己的幾台裝置串成一個私人網路，手機在外面也能連回家裡的電腦，而且不用把電腦開放到網路上。

只要設定一次：

1. **電腦**：到 https://tailscale.com/download 下載 Windows 版，裝好後登入（可以用 Google、Microsoft 等帳號）。
2. **手機**：到 App Store 或 Play 商店裝「Tailscale」，用**同一個帳號**登入，然後把 VPN 打開。
3. **找電腦的 Tailscale IP**：點 Windows 工作列上的 Tailscale 圖示，會看到一個 `100.` 開頭的 IP。
4. **在手機上**打開下面這個網址，再加到主畫面：

   ```
   http://100.x.x.x:8790/?k=<你的金鑰>
   ```

   金鑰在 `config.json` 的 `key` 欄位，伺服器啟動時也會印出來。

設定好之後，在家用 Wi-Fi、在外用行動網路都能開，只要：

- 電腦開著，而且伺服器有在跑（跑過 `install-autostart.ps1` 的話，登入電腦就會自動啟動）
- 手機上的 Tailscale 是開著的

注意：

- 手機第一次透過 Tailscale 連進來時，Windows 防火牆可能會再問一次。Windows 有時會把 Tailscale 的網路當成「公用網路」，那邊也要允許，不然手機連不進來。
- 不要在路由器上把 8790 這個 port 開到公開網路。網址裡的金鑰只是簡單擋一下，擋不住認真想進來的人。

## 限制和已知問題

- Claude Code 的登入 token 幾個小時就會過期，你用 Claude Code 的時候它會自動更新。如果很久沒開 Claude Code，面板會顯示「登入憑證過期」，並保留上一次的數字，等你再開一次 Claude Code 就會恢復。
- 網址裡的金鑰只是簡單擋一下同一個 Wi-Fi 的其他人。拿到連結的人看得到你的用量數字（只有數字，看不到登入資料）。
- 這是加到主畫面的網頁 App，不是原生的桌面小工具，打開時才會更新。

## 設定

`config.json`（第一次執行時建立，不會進 git）：

| 欄位 | 意思 |
| --- | --- |
| `port` | 伺服器 port，預設 8790 |
| `key` | 網址裡的金鑰。刪掉後重啟就會產生新的 |
| `extraConfigDirs` | 額外要找登入資料的 Claude Code 設定資料夾（選填） |

環境變數 `PORT` 和 `USAGE_KEY` 可以覆蓋上面的設定。
