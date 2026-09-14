# 飛象影片學習站（Web App 版）

學生打開一個網址 → 看到老師編輯的節目列表 → 點擊觀看 → 依時間片段顯示詞匯與中文、A-B 循環學習、一鍵匯出卡片。
以 Cloudflare Pages 免費部署，**學生端零安裝、零設定**。

## 架構

```
index.html              首頁：節目清單（老師在 programs.json 編輯）
player.html             播放頁：影片 + A-B 循環 + 詞匯面板
srt-tool.html           老師工具：抓取/貼上字幕 → 翻譯 → 匯出 SRT → 產生詞匯表
css/style.css           共用樣式（暗色磨砂玻璃 + 電光藍）
js/programs.js          首頁邏輯
js/player.js            播放頁主邏輯（A-B、詞匯片段、快捷鍵、持久化）
js/captions.js          字幕引擎（SRT 優先 → Function 自動抓取）
js/vocab.js             詞匯引擎（句群切段、斷詞、停用詞、詞匯 JSON 載入）
js/anki.js              匯出模組（剪貼簿複製 + Anki CSV）
functions/api/captions.js  Cloudflare Pages Function：自動抓取 YouTube 字幕
programs.json           節目清單設定檔（老師編輯）
subtitles/              （選用）老師上傳的 SRT 字幕檔
vocabulary/             （選用）老師產生的詞匯 JSON
```

## 快速開始

**方式一：本機預覽（無需部署）**
```bash
# 在專案資料夾內
python -m http.server 8000
# 開啟 http://localhost:8000
```
> 本機預覽時「自動抓取字幕」不會運作（沒有 Function），會顯示提示；上傳 SRT 後即可看到字幕。完整功能需部署到 Cloudflare Pages。

**方式二：部署到 Cloudflare Pages（正式使用）**
1. 把整個專案資料夾推上 GitHub（或直接連線到 GitHub repo）。
2. 開啟 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → Create → Pages → Connect to Git。
3. 選中 repo → 建置設定留空（靜態網站）→ 部署。完成後會得到網址：
   `https://你的專案名.pages.dev`
4. `functions/api/captions.js` 會被 Cloudflare 自動部署為 `/api/captions`，無需任何設定。
5. 把這個網址給學生即可。每次改 `programs.json` 或上傳 SRT，push 後自動更新。

## 老師如何編輯節目清單（programs.json）

```json
{
  "siteName": "飛象影片學習站",
  "defaultLang": "en",
  "programs": [
    {
      "id": "xiyouji",
      "title": "Journey to the West 1-3（西遊記）",
      "videoId": "gj1v-L1bEQc",
      "lang": "en",
      "description": "Little Fox 經典故事動畫，含英文自動字幕。",
      "srt": ""
    }
  ]
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | 是 | 唯一識別碼（網址用，用小寫英文） |
| `title` | 是 | 顯示名稱 |
| `videoId` | 是 | YouTube 影片 ID（`youtu.be/XXXXX` 或 `watch?v=XXXXX` 的 XXXXX） |
| `lang` | 否 | 字幕語言代碼，如 `zh-Hant`、`zh-CN`、`en`、`ja`；缺省用 `defaultLang` |
| `description` | 否 | 卡片上的說明文字 |
| `srt` | 否 | 指定 SRT 路徑；留空 = 自動找 `subtitles/{videoId}.srt` |
| `vocab` | 否 | 指定詞匯 JSON 路徑；留空 = 自動找 `vocabulary/{videoId}.json` |

## 字幕雙軌（重要）

| 軌 | 來源 | 時機 | 可靠性 |
|---|---|---|---|
| ① 老師 SRT | `subtitles/{videoId}.srt` | 播放頁先檢查 | 100%（建議教學用） |
| ② 自動抓取 | Cloudflare Function | 無 SRT 時呼叫 | 不可靠（YouTube 已限制伺服器端抓取） |

> 現況：YouTube 已對伺服器端抓取字幕加上限制（需要 proof-of-origin 權杖、且常對資料中心 IP 限流），自動抓取多半失敗。**建議老師用 srt-tool 手動取得轉錄稿**（見下）後上傳 SRT。

## 詞匯面板（播放頁）

播放頁右側是「詞匯」面板，依時間片段顯示：

- 字幕被切成約 10 秒的**片段**（把連續字幕句合併，段界落在句子交界）。
- 每段列出該段出現的**英文詞匯**（已轉小寫、去停用詞、基本詞形合併）。
- **點詞**：把該詞中文釘在上方放大顯示，並 **A-B 循環本段**。
- `自動跟隨`：跟隨播放自動切換片段（可鎖定）；另有 `‹ 上一段`／`下一段 ›`。
- 搜尋框輸入詞按 `Enter` → 跳到含該詞的片段。
- `校時`：微調字幕／片段對齊（秒）。

詞匯來源：`vocabulary/{videoId}.json`（老師用 srt-tool 步驟 5 產生）；沒有此檔時，播放頁會即時抽取英文詞（無中文）。

## 老師工具：SRT 字幕產生器（srt-tool.html）

給老師製作繁體中文字幕與詞匯表用。開啟方式：部署後到 `https://你的專案名.pages.dev/srt-tool.html`，或本機預覽時開 `http://localhost:8000/srt-tool.html`。

使用流程：

1. **選擇來源**：貼上 YouTube 網址按「從 YouTube 抓取字幕」（現多被限制）；建議按「開啟影片轉錄稿」→ 在 YouTube「⋯ 更多」→「顯示轉錄稿」→ 全選複製 → 貼到「貼上字幕文字」解析。或上傳現有 `.srt` 檔繼續編輯。
2. **翻譯成繁體中文**：一鍵整批翻譯（免費服務 MyMemory）。選填聯絡信箱可把每日免費額度從約 5,000 字提升至 50,000 字；個別句子翻譯不佳可留空手動補。
3. **逐句編輯**：每行有時間、英文原文、繁體中文三個欄位，可直接修改；可新增／刪除句子；時間重疊會在匯出時自動修正。
4. **匯出 SRT**：選擇輸出內容（中英雙語／只繁體中文／只英文）→ 預覽 → 下載 `{影片 ID}.srt`（UTF-8 BOM）。把檔案放進 `subtitles/` 再 push。
5. **產生詞匯表**：選片段長度（8/10/15 秒）→「產生詞匯表」→ 可「翻譯詞匯（中文）」、逐詞修改或刪除 → 下載 `{影片 ID}.json`，放進 `vocabulary/` 再 push。

> 翻譯失敗或額度不足時，對應項目會留空待手動補上，不會中斷流程。

## 快捷鍵

| 按鍵 | 功能 |
|---|---|
| `Alt+A`（Mac: `Option+A`） | 切換 A-B 循環 |
| `[` / `]` | 把目前時間設為 A 點 / B 點 |
| `←` / `→` | 循環開啟時，A / B 點微調 0.1 秒 |
| `A` / `D` | 循環開啟時，跳上一句 / 下一句 |
| `Space` | 播放 / 暫停 |

點擊時間軸可跳轉；拖曳左右白色把手調整 A-B 區間；點詞匯 → 循環該片段；點擊 A / B 時間數字 → 設為目前時間。

## 匯出卡片

- **複製卡片**：把 A-B 區間的字幕（含標題、時間、回播連結）複製到剪貼簿，可直接貼進 Anki 編輯器。
- **匯出 CSV**：下載 Anki 相容 CSV（Front / Back / Tags），Anki 匯入即可建立卡片。

## 已知限制（V1）

- 字幕品質取決於來源：YouTube 自動字幕（ASR）常無標點、無正確大小寫，因此**播放頁不顯示逐句字幕**，改以詞匯為主。
- 詞形合併為簡易規則（複數 + 少量不規則），仍可能有同義/同形詞重複，老師可在工具中刪除。
- 無登入/班級管理；所有學生共用同一清單。
- 自動抓取字幕現多被 YouTube 限制，建議老師自備 SRT 與詞匯 JSON。
- 影片若為年齡/地區限制，iframe 可能無法播放（會在頁面顯示錯誤）。

## V2 候選方向

- 班級帳號與進度統計；老師後台表單（免改 JSON）新增節目。
- 詞匯「跟讀／測驗」模式（聽一段 → 選詞義 → 錄音對比）。
- 已保存片段庫（收藏 A-B 區間，跨影片管理）。
