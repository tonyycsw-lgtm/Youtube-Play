# 飛象影片學習站（Web App 版）

學生打開一個網址 → 看到老師編輯的節目列表 → 點擊觀看 → 依時間片段顯示老師提供的詞匯與中文、A-B 循環學習。
以 Cloudflare Pages 免費部署，**學生端零安裝、零設定**。

## 架構

```
index.html              首頁：節目清單（內建 programs.json + 雲端自訂清單）
player.html             播放頁：影片 + A-B 循環 + 詞匯面板
css/style.css           共用樣式（暗色磨砂玻璃 + 電光藍）
js/programs.js          首頁邏輯（合併靜態與雲端節目、渲染卡片）
js/add-video.js         首頁「新增影片」：連結解析／JSON 轉換／呼叫 API
js/player.js            播放頁主邏輯（A-B、詞匯片段、快捷鍵、持久化）
js/player-adapters.js   播放器轉接層（YouTube IFrame／HTML5 媒體／TikTok Embed）
js/vocab.js             詞匯引擎（只從 Cloudflare KV 載入詞匯 JSON）
functions/api/programs.js    Function：/api/programs（GET 列出、POST 新增自訂節目）
functions/api/vocab/[id].js  Function：/api/vocab/{id}（讀取 KV 內的詞匯 JSON）
functions/api/oembed.js      Function：/api/oembed（代理 YouTube oEmbed，抓標題/縮圖）
wrangler.toml           Cloudflare 設定（KV 綁定 KV_BINDING）
programs.json           節目清單設定檔（老師編輯）
```

## 快速開始

**方式一：本機預覽（無需部署）**
```bash
# 在專案資料夾內
python -m http.server 8000
# 開啟 http://localhost:8000
```
> 本機預覽沒有 Cloudflare Function，只能看內建節目（無法顯示詞匯）；「新增影片」與詞匯需部署後才能使用。

**方式二：部署到 Cloudflare Pages（正式使用）**
1. 把整個專案資料夾推上 GitHub（或直接連線到 GitHub repo）。
2. 開啟 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → Create → Pages → Connect to Git。
3. 選中 repo → 建置設定留空（靜態網站）→ 部署。完成後會得到網址：
   `https://你的專案名.pages.dev`
4. 依下方〈Cloudflare KV 設定〉綁定 KV；`functions/api/*` 會被 Cloudflare 自動部署為 `/api/*`。
5. 把這個網址給學生即可。每次改 `programs.json` push 後自動更新；用首頁「新增影片」則即時存入 KV。

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
      "description": "Little Fox 經典故事動畫，適合 A-B 循環練聽力。"
    }
  ]
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | 是 | 唯一識別碼（網址用，用小寫英文） |
| `title` | 是 | 顯示名稱 |
| `videoId` | 是 | YouTube 影片 ID（`youtu.be/XXXXX` 或 `watch?v=XXXXX` 的 XXXXX） |
| `lang` | 否 | 語言代碼，如 `zh-Hant`、`zh-CN`、`en`、`ja`；缺省用 `defaultLang` |
| `description` | 否 | 卡片上的說明文字 |

## 在首頁新增影片（免改 JSON；存 Cloudflare KV）

首頁右上角「＋ 新增影片」提供兩種方式，資料寫入 Cloudflare KV（**所有學生可見**，不需重新部署）：

| 方式 | 輸入 | 說明 |
|---|---|---|
| YouTube 連結 | 例如 `https://youtu.be/KTCJC4GMPzg?si=...` | 自動解析影片 ID、透過 oEmbed 帶入標題 |
| TikTok 連結 | 例如 `https://www.tiktok.com/@user/video/123...` | 使用官方 Embed Player（postMessage），可 A-B 循環 |
| 媒體檔 URL | 例如 `https://.../clip.mp4`、`https://.../song.mp3` | 直接用 HTML5 `<video>`／`<audio>` 播放 |
| 上載 JSON | 例如 `Beauty_and_the_beast_Ep1-3.json` | 自動讀取 `videoInfo.url` 與 `videoInfo.title`，並把詞匯轉成播放頁格式存入 KV |

- 支援兩種詞匯 JSON 格式：`{ segments:[{start,end,words:[{w,src,zh}]}] }` 與 `{ wordSegments:[{timeRange, vocabularies:[{word,meaning}]}] }`（會自動轉換）。
- 播放頁的詞匯**唯一來源是 KV**（`api/vocab/{videoId}`）；不再讀取 repo 內的 JSON。沒有上載 JSON 的影片不會顯示詞匯。
- 同一影片**可重新上載覆寫**（更新標題／說明與詞匯）；沒有獨立的編輯／刪除介面，要刪除需到 Cloudflare Dashboard → KV 刪除 `program:{videoId}` 與 `vocab:{videoId}`。
- **不設保護**：任何取得網址的人（含學生）都能新增，KV 寫入端點公開，請自行評估風險。
- KV 為最終一致性，新增後可能數十秒才全球生效；重新整理即可。

### Cloudflare KV 設定（部署前一次）

1. Cloudflare Dashboard → Workers & Pages → KV → 建立 namespace（例如 `youtube-play`）。
2. 把 namespace id 填入 `wrangler.toml` 的 `kv_namespaces`（binding 名稱須為 `KV_BINDING`）：
   ```toml
   name = "youtube-play-cyj"
   pages_build_output_dir = "."
   compatibility_date = "2024-01-01"

   [[kv_namespaces]]
   binding = "KV_BINDING"
   id = "你的 namespace id"
   ```
3. 也可改用 Dashboard：Pages 專案 → Settings → Functions → KV namespace bindings → 綁定 `KV_BINDING`（Production 與 Preview 都要）。
4. 重新部署後，`/api/programs`、`/api/vocab/{id}` 才會讀寫 KV。

## 播放來源（YouTube／TikTok／媒體檔）

播放頁以「播放器轉接層」支援多種來源；學習功能（A-B 循環、詞匯／字幕依時間同步、校時）只要來源能回報播放時間就能運作：

| 來源 | 播放方式 | A-B 循環 | 變速 | 備註 |
|---|---|---|---|---|
| YouTube | IFrame API | ✅ | ✅ | 預設 |
| TikTok | 官方 Embed Player（postMessage） | ✅ | ❌ | 播放器不提供變速 |
| 媒體檔 mp4/webm… | HTML5 `<video>` | ✅ | ✅ | 需允許直連與 CORS／range |
| 音頻 mp3/m4a… | HTML5 `<audio>` | ✅ | ✅ | 播放頁顯示封面圖示＋標題 |

- 節目資料的 `source`：`youtube`（預設）、`tiktok`、`file`；`file` 另有 `src` 與 `mediaType`。
- 詞匯 key 用節目 `id`：YouTube 用 `videoId`、TikTok 用 `tt_<貼文ID>`、媒體檔用 `f_<URL 短雜湊>`。
- 舊資料（只有 `videoId`）會視為 YouTube，完全相容。
- 目前媒體檔**只支援貼 URL**，尚未提供上載（R2）功能。
- 尚未支援：抖音（Douyin）、Facebook、Instagram；Vimeo 規劃於 Phase 2。貼上這些連結會顯示明確的「不支援」訊息（不會誤判成 YouTube）。

## 詞匯面板（播放頁）

播放頁右側是「詞匯」面板，依時間片段顯示：

- 詞匯內容**一律由老師提供的 JSON 決定**（每個片段有 `start`／`end`、選填 `en`／`zh` 句子與 `words`）。
- 每個詞顯示為 `原形 (原型)`（例如 `thought (think)`）；點詞會把中文釘在上方固定高度的區塊並**暫停影片**。
- 進度條上方（影片視窗外）顯示該段**字幕**：上行為 `en`、下行 `zh`；右側 `A−`／`A＋` 調整字級，拖曳字幕下緣可調整容器高度（兩者都會記住）；內容放不下時字體會自動縮小，版面不跳動。
- 字幕中的**詞**可互動：滑過變綠；點擊會**暫停影片**並在右側詞匯面板顯示該詞翻譯；點字幕空白處則切換播放／暫停。
- `自動跟隨`：跟隨播放自動切換片段（可鎖定）；另有 `‹ 上一段`／`下一段 ›`（快捷鍵 `A`／`D`）。
- 搜尋框輸入詞按 `Enter` → 跳到含該詞的片段。
- `校時`：微調詞匯片段與影片的對齊（秒）。
- 拖曳／點擊時間軸時，字幕與詞匯會**立即更新**，不受影片載入或緩衝速度影響。

詞匯 JSON 格式（在首頁上載後存於 KV）：

```json
{
  "videoId": "gj1v-L1bEQc",
  "window": 10,
  "segments": [
    {
      "start": 0,
      "end": 14,
      "en": "Beauty made the cottage a home. She made curtains.",
      "zh": "貝兒把小屋變成家。她做了窗簾。",
      "words": [
        { "w": "think", "src": "thought", "zh": "想" },
        { "w": "magic", "src": "magic", "zh": "魔法" }
      ]
    }
  ]
}
```

| 欄位 | 說明 |
|---|---|
| `start` / `end` | 這段影片的起訖秒數 |
| `window` | 產生時使用的段落長度（秒），僅供參考 |
| `en` | 該段英文字幕（選填；來源 JSON 的 `englishSentence` 會自動對應） |
| `zh` | 該段中文翻譯（選填；來源 JSON 的 `chineseTranslation` 會自動對應） |
| `words` | 該段詞匯 |
| `w` | 原型詞（小寫） |
| `src` | 實際出現的字；與 `w` 不同時顯示為 `src (w)` |
| `words[].zh` | 詞的繁體中文翻譯（可留空） |

## 快捷鍵

| 按鍵 | 功能 |
|---|---|
| `Alt+A`（Mac: `Option+A`） | 切換 A-B 循環 |
| `[` / `]` | 把目前時間設為 A 點 / B 點 |
| `←` / `→` | 循環開啟時，A / B 點微調 1 秒 |
| `A` / `D` | 上一段 / 下一段詞匯 |
| `Space` | 播放 / 暫停 |

點擊時間軸可跳轉；拖曳左右白色把手調整 A-B 區間；點詞匯 → 暫停並顯示中文；點擊 B 時間數字 → 設為目前時間；滑過 A 時間數字會變黃，點擊即從 A 點重播。
開場預設 A-B 為前 10 秒、循環預設關閉（曾調整過則沿用上次設定）；左上「← 節目清單」為放大按鈕。

## 已知限制（V1）

- 詞匯完全取決於老師上載的 JSON；沒有 JSON 時播放頁不顯示任何詞匯。
- 無登入/班級管理；所有學生共用同一清單。
- 首頁「新增影片」不設保護；任何取得網址的人都能新增或覆寫（資料存 KV），且沒有刪除介面。
- 影片若為年齡/地區限制，iframe 可能無法播放（會在頁面顯示錯誤）。
- 媒體檔 URL 需允許直連與 CORS／range，否則讀不到播放時間，A-B 與詞匯同步會失效。
- TikTok 不支援變速；部分影片可能不允許嵌入。

## V2 候選方向

- 班級帳號與進度統計；首頁自訂節目的編輯／刪除與排序（目前僅能新增）。
- 詞匯「跟讀／測驗」模式（聽一段 → 選詞義 → 錄音對比）。
- 已保存片段庫（收藏 A-B 區間，跨影片管理）。
