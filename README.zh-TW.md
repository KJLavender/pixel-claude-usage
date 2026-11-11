# Pixel Claude Usage

[English](README.md) | **繁體中文**

一個像素風的小面板，讓你在手機上看自己的 Claude 方案用量用了多少。

它會在你的電腦上跑一個小伺服器。伺服器讀取 Claude Code 已經存在這台電腦上的登入資料，向 Anthropic 查目前的用量，再提供一個手機大小的網頁。你在手機上打開這個網頁、加到主畫面，用起來就像一個小工具 App。

畫面上會顯示：

- **5H SESSION**：目前這個 5 小時額度用了多少、還剩多少、什麼時候重置。時間一到會直接顯示 0% 和「已重置」。
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

## 手機桌面小工具

除了網頁，也可以在手機主畫面放一個小工具（像有些 App 的載具條碼小工具那樣），不用打開任何東西就能看到 5 小時和每週用量。點一下會打開完整面板。

兩種版本都要用到面板網址，也就是 QR code 打開的那個連結，例如 `http://192.168.0.16:8790/?k=<你的金鑰>`。`/pair` 頁面上每個 QR code 下面都有寫。

小工具只有在手機連得到電腦時才會更新（同一個 Wi-Fi，或開著 Tailscale）。連不到時會保留上次的數字並顯示提示。重置時間一到，就算還沒抓到新資料也會直接顯示 0%。

### iPhone（Scriptable）

1. 到 App Store 安裝 [Scriptable](https://apps.apple.com/app/scriptable/id1405459188)（免費）。
2. 在 iPhone 的 Safari 打開你的面板網址，但把 `/?k=` 改成 `/widget.js?k=`，例如 `http://192.168.0.16:8790/widget.js?k=<你的金鑰>`。畫面會顯示已經填好你網址的小工具腳本。
3. 全選、拷貝，到 Scriptable 按 **+** 新增腳本，貼上。
   （也可以從 GitHub 複製 [`widgets/ios/ClaudeUsage.js`](widgets/ios/ClaudeUsage.js)，再自己改最上面的 `PANEL_URL`。）
4. 按 ▶ 試跑，應該會跳出小工具的預覽畫面。
5. 在主畫面長按 → 左上 **+** → 找 Scriptable → 選中型（或小型）→ 加入。再長按小工具 → **編輯小工具** → **Script** 選這個腳本。

小工具多久更新一次是 iOS 決定的，通常 15 到 30 分鐘一次，打開面板也不會讓它馬上更新。

### Android

1. 用手機打開 [Releases 頁面](https://github.com/KJLavender/pixel-claude-usage/releases)，下載最新版裡的 `ClaudeUsageWidget.apk`。
2. 點下載好的檔案安裝。Android 會問要不要允許瀏覽器或檔案管理員安裝 App，這是不從 Play 商店安裝時的正常提示。
3. 在主畫面長按 → **小工具** → 找 **Claude Usage** → 拖到主畫面上。
4. 會跳出設定畫面，貼上面板網址，按 **儲存**。

小工具大約每 30 分鐘自動更新一次（這是 Android 預設允許的最短間隔）。點小工具上的 ↻ 可以馬上更新。之後要改網址，打開 Claude Usage 這個 App 就可以改。

APK 是 GitHub Actions 用 [`widgets/android`](widgets/android) 裡的程式碼編出來的。每次編譯都會用新的測試用簽章，所以要更新到新版時，得先把舊版解除安裝。

## 分享給朋友用（多帳號）

如果朋友沒有一台能一直開著的電腦，可以借用你的。每個朋友會有自己的連結，而且只看得到自己的用量。

新增朋友（在你的電腦上、專案資料夾裡執行）：

```
node server.mjs add-account alice
```

這會在獨立的資料夾（`accounts/alice`）裡執行 `claude auth login`，讓朋友登入**他自己的** Claude 帳號，跟著畫面上的指示做就好。如果在你的電腦上打開了瀏覽器，朋友可以在那裡登入，最好用無痕視窗，他的 claude.ai 登入才不會留在你的瀏覽器裡。完成後指令會印出朋友專屬的連結，只傳給他本人。伺服器正在跑的話會自己讀到新帳號，不用重開；`/pair` 頁面也會列出每個人的 QR code。

其他指令：

```
node server.mjs list-accounts           # 列出所有人的連結
node server.mjs remove-account alice    # 把他登出，並從這台電腦刪掉他的登入資料
```

開始之前，你們兩個都要知道：

- 朋友的 Claude 登入資料會存在你的電腦上（`accounts/<名字>/.credentials.json`）。能控制你電腦的人，就能用他的 Claude 帳號。只跟信得過你的人這樣做。
- 不要直接從朋友的電腦複製登入檔過來，一定要用 `add-account` 重新登入。登入檔裡的更新憑證只能用一次，兩台電腦共用同一份登入會一直互相把對方登出。
- 自動更新登入（見「運作方式」）會用朋友的帳號執行，所以會用掉一點點**他的**額度。
- 朋友也要連得到你的電腦：同一個 Wi-Fi，或用 Tailscale。Tailscale 可以只把這一台電腦分享給他。
- TODAY 那一格只有你自己看得到。朋友沒有在你的電腦上用 Claude Code，所以沒有他的本機紀錄。

## 開機自動啟動

```
powershell -ExecutionPolicy Bypass -File install-autostart.ps1
```

這會在 Windows 的「啟動」資料夾放一個小腳本，之後每次登入電腦，伺服器都會在背景自動啟動。加上 `-Remove` 再跑一次就會取消。

## 運作方式

- 登入資料：Claude Code 會把登入資料存在設定資料夾裡的 `.credentials.json`（`~/.claude`，有設 `CLAUDE_CONFIG_DIR` 的話就是那個資料夾）。伺服器只讀這個檔案、挑最新的 token 來用，自己不會寫入它。
- 保持登入有效：登入 token 幾個小時就會過期。快過期前幾分鐘，伺服器會用最便宜的 Haiku 模型叫 Claude Code 回一個字，Claude Code 會順便更新並存好自己的登入。所以就算你一整天沒開 Claude Code，面板也會繼續更新。最多 20 分鐘做一次，實際上一天大概幾次，只會用掉一點點額度。不想要的話，在 `config.json` 設 `"autoRefresh": false`。
- 為什麼不讓伺服器自己更新 token：用來更新的那組憑證（refresh token）只能用一次。如果伺服器自己拿去用，Claude Code 存的那份就失效了，你得重新登入。交給 Claude Code 自己更新就不會有這個問題。
- 用量資料來自 `https://api.anthropic.com/api/oauth/usage`，跟 Claude Code 的 `/usage` 指令是同一個來源。這不是官方公開文件裡的 API，之後可能會變。
- 伺服器在背景每 5 分鐘查一次用量，網頁要資料時最多一分鐘查一次。網頁開著時每分鐘更新一次，切回來的時候也會更新。
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

### 其他方法

我只測過上面「在家用 Wi-Fi」的設定。下面是其他常見的做法，還沒有拿這個專案實際試過：

- **ZeroTier**（https://www.zerotier.com/）：用法跟 Tailscale 差不多。兩邊都裝、加入同一個網路，再用電腦的 ZeroTier IP 連。設定比 Tailscale 麻煩一點。
- **Cloudflare Tunnel**（`cloudflared`）：不用開 port 就能拿到一個公開的 https 網址，手機也不用裝任何 App。缺點是拿到連結的人都看得到你的用量數字，所以連結不要外流。執行 `cloudflared tunnel --url http://localhost:8790` 會拿到一個臨時網址，每次重開都會變；要固定網址的話，需要 Cloudflare 帳號和自己的網域。
- **路由器開 port（port forwarding）**：不建議。網頁會直接暴露在網路上，網址裡的金鑰只是簡單擋一下。
- **Radmin VPN**：只有 Windows 版，沒有手機 App，所以不能用在這裡。

## 限制和已知問題

- 如果自動更新失敗（例如電腦沒網路，或 Claude Code 本身的登入已經失效），面板會顯示提示，並保留上一次的數字。在電腦上開一次 Claude Code 就會恢復。
- 網址裡的金鑰只是簡單擋一下同一個 Wi-Fi 的其他人。拿到連結的人看得到你的用量數字（只有數字，看不到登入資料）。
- 網頁本身只有打開時才會更新。想不打開就看到數字，請用上面的手機桌面小工具。

## 設定

`config.json`（第一次執行時建立，不會進 git）：

| 欄位 | 意思 |
| --- | --- |
| `port` | 伺服器 port，預設 8790 |
| `key` | 網址裡的金鑰。刪掉後重啟就會產生新的 |
| `extraConfigDirs` | 額外要找登入資料的 Claude Code 設定資料夾（選填） |
| `autoRefresh` | 設成 `false` 就關掉自動更新登入（預設開啟） |
| `accounts` | 用 `add-account` 加入的朋友（名字、金鑰、登入資料夾）。請用指令管理，不要手動改 |
| `claudePath` | `claude` 程式的完整路徑，PATH 裡找不到時才需要（選填） |

環境變數 `PORT` 和 `USAGE_KEY` 可以覆蓋上面的設定。
