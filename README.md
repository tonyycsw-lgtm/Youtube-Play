# 飛象影片學習站（Web App 版）

學生打開一個網址 → 看到老師編輯的節目列表 → 點擊觀看 → 字幕疊加、A-B 循環學習、一鍵匯出卡片。
以 Cloudflare Pages 免費部署，**學生端零安裝、零設定**。

## 架構

```
index.html              首頁：節目清單（老師在 programs.json 編輯）
player.html             播放頁：影片 + 字幕疊加 + A-B 循環 + 逐句面板
srt-tool.html           老師工具：抓取/貼上字幕 → 翻譯成繁體中文 → 匯出 SRT
css/style.css           共用樣式（暗色磨砂玻璃 + 電光藍）
js/programs.js          首頁邏輯
js/player.js            播放頁主邏輯（A-B、快捷鍵、單句循環、持久化）
js/captions.js          字幕引擎（SRT 優先 → Function 自動抓取）
js/anki.js              匯出模組（剪貼簿複製 + Anki CSV）
functions/api/captions.js  Cloudflare Pages Function：自動抓取 YouTube 字幕
programs.json           節目清單設定檔（老師編輯）
subtitles/              （選用）老師上傳的 SRT 字幕檔
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

## 字幕雙軌（重要）

| 軌 | 來源 | 時機 | 可靠性 |
|---|---|---|---|
| ① 老師 SRT | `subtitles/{videoId}.srt` | 播放頁先檢查 | 100%（建議教學用） |
| ② 自動抓取 | Cloudflare Function | 無 SRT 時呼叫 | 視 YouTube 對伺服器 IP 的態度而定 |

若自動抓取被 YouTube 限制，播放頁會顯示偵測到的字幕軌清單並提示「上傳 SRT 覆蓋」。學生端永遠不會壞掉——最多是沒有自動字幕，需老師補 SRT。

## 老師工具：SRT 字幕產生器（srt-tool.html）

給老師製作繁體中文字幕用（兒童學英文情境下，預設輸出「英文在上、中文在下」的中英對照 SRT）。開啟方式：部署後到 `https://你的專案名.pages.dev/srt-tool.html`，或本機預覽時開 `http://localhost:8000/srt-tool.html`。

使用流程：

1. **選擇來源**：貼上 YouTube 網址按「從 YouTube 抓取字幕」（部署後運作）；或直接貼上字幕文字（YouTube「顯示轉錄稿」複製內容、或 SRT 全文）；或上傳現有 `.srt` 檔繼續編輯。
2. **翻譯成繁體中文**：一鍵整批翻譯（免費服務 MyMemory）。選填聯絡信箱可把每日免費額度從約 5,000 字提升至 50,000 字；個別句子翻譯不佳可留空手動補。
3. **逐句編輯**：每行有時間、英文原文、繁體中文三個欄位，可直接修改；可新增／刪除句子；時間重疊會在匯出時自動修正。
4. **匯出**：選擇輸出內容（中英雙語／只繁體中文／只英文）→ 預覽 → 下載 `{影片 ID}.srt`（UTF-8 BOM）。把檔案放進專案 `subtitles/` 資料夾再 push，學生端即自動使用。

> 翻譯失敗或額度不足時，對應句子會留空待手動補上，不會中斷流程。

## 快捷鍵

| 按鍵 | 功能 |
|---|---|
| `Alt+A`（Mac: `Option+A`） | 切換 A-B 循環 |
| `[` / `]` | 把目前時間設為 A 點 / B 點 |
| `←` / `→` | 循環開啟時，A / B 點微調 0.1 秒 |
| `A` / `D` | 循環開啟時，跳上一句 / 下一句 |
| `C` | 字幕顯示開關 |
| `Space` | 播放 / 暫停 |

點擊時間軸可跳轉；拖曳左右白色把手調整 A-B 區間；點擊逐句面板中的任何一句 → 該句單句循環；點擊 A / B 時間數字 → 設為目前時間。

## 匯出卡片

- **複製卡片**：把 A-B 區間的字幕（含標題、時間、回播連結）複製到剪貼簿，可直接貼進 Anki 編輯器。
- **匯出 CSV**：下載 Anki 相容 CSV（Front / Back / Tags），Anki 匯入即可建立卡片。

## 已知限制（V1）

- 字幕品質取決於來源：YouTube 自動字幕（ASR）可能有錯字，建議教學重點片段上傳 SRT 校正。
- 無登入/班級管理；所有學生共用同一清單。
- 自動抓取字幕屬灰區作法，若 YouTube 政策變化可能失效——SRT 軌保證可用，是永久後備。
- 影片若為年齡/地區限制，iframe 可能無法播放（會在頁面顯示錯誤）。

## V2 候選方向

- 班級帳號與進度統計；老師後台表單（免改 JSON）新增節目。
- 字幕逐句「跟讀」模式（聽一句 → 暫停 → 錄音對比）。
- 已保存片段庫（收藏 A-B 區間，跨影片管理）。
