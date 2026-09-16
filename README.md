> ⚠️ **已整併（2026-09）**：本專案已併入 lyow（播放器位於 `lyow.app/y`，資料改存 lyow R2 `data/youtube/`，寫入經 lyow `api/youtube/*`）。此 repo 與 Cloudflare Pages／KV 已停用，僅保留作歷史參考。以下內容為整併前說明。

# 飛象影片學習站（Web App 版）

學生打開一個網址 → 看到老師編輯的節目列表 → 點擊觀看 → 依時間片段顯示老師提供的詞匯與字幕。
以 Cloudflare Pages 免費部署，**學生端零安裝、零設定**。

## 架構

```
index.html              首頁：節目清單（內建 programs.json + 雲端自訂清單）
player.html             播放頁：影片 + 詞匯面板
css/style.css           共用樣式（暗色磨砂玻璃 + 電光藍）
js/programs.js          首頁邏輯（合併靜態與雲端節目、渲染卡片）
js/add-video.js         首頁「新增影片」：連結解析／JSON 轉換／呼叫 API
js/player.js            播放頁主邏輯（詞匯片段、快捷鍵、持久化）
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
      "description": "Little Fox 經典故事動畫，適合練聽力。"
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

首頁右上角「＋ 新增影片」（**僅限管理員**，見下方〈權限〉）提供兩種方式，資料寫入 Cloudflare KV（**所有學生可見**，不需重新部署）：

| 方式 | 輸入 | 說明 |
|---|---|---|
| YouTube 連結 | 例如 `https://youtu.be/KTCJC4GMPzg?si=...` | 自動解析影片 ID、透過 oEmbed 帶入標題 |
| TikTok 連結 | 例如 `https://www.tiktok.com/@user/video/123...` | 使用官方 Embed Player（postMessage），可詞匯同步 |
| 抖音連結 | 例如 `https://www.douyin.com/video/123...` 或短連結 `https://v.douyin.com/xxxx/` | 官方 open player 嵌入，**僅供觀看**；短連結會自動解析 |
| 媒體檔 URL | 例如 `https://.../clip.mp4`、`https://.../song.mp3` | 直接用 HTML5 `<video>`／`<audio>` 播放 |
| 上載 JSON | 例如 `Beauty_and_the_beast_Ep1-3.json` | 自動讀取 `videoInfo.url` 與 `videoInfo.title`，並把詞匯轉成播放頁格式存入 KV |

- 支援兩種詞匯 JSON 格式：`{ segments:[{start,end,words:[{w,src,zh}]}] }` 與 `{ wordSegments:[{timeRange, vocabularies:[{word,meaning}]}] }`（會自動轉換）。
- 播放頁的詞匯**唯一來源是 KV**（`api/vocab/{videoId}`）；不再讀取 repo 內的 JSON。沒有上載 JSON 的影片不會顯示詞匯。
- 可選填**封面圖 URL**；上載 JSON 時若含 `videoInfo.thumbnail`／`thumbnail`／`cover` 會自動帶入。卡片優先顯示封面圖，其次 YouTube 自動縮圖，否則顯示品牌圖示。
- 同一影片**可重新上載覆寫**（更新標題／說明／封面與詞匯）；自訂卡片右上角有「✕」可**刪除**（同時刪除其詞匯）。靜態 `programs.json` 的節目無法從介面刪除。
- **權限**：新增／刪除影片需以 lyow 管理員身分登入（Firebase `admin` custom claim）。前端會隱藏按鈕（fail-closed），Cloudflare Function 亦以 `Authorization: Bearer <idToken>` 驗證簽章與 claim，未授權請求回 401／403。
- 經 lyow.app 使用時，播放器由 `lyow.app/y/` 同源代理（見 lyow-router `vercel.json`），因此能直接共用 lyow 的登入狀態；直連本網域時管理員需另行登入（須把網域加入 Firebase 授權網域）。
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

播放頁以「播放器轉接層」支援多種來源；詞匯／字幕依時間同步，只要來源能回報播放時間就能運作：

| 來源 | 播放方式 | 時間同步 | 變速 | 備註 |
|---|---|---|---|---|
| YouTube | IFrame API | ✅ | ✅ | 預設 |
| TikTok | 官方 Embed Player（postMessage） | ✅ | ❌ | 播放器不提供變速 |
| 抖音 Douyin | 官方 open player 嵌入 | ❌ | ❌ | 僅供觀看（無時間控制 API） |
| 媒體檔 mp4/webm… | HTML5 `<video>` | ✅ | ✅ | 需允許直連與 CORS／range |
| 音頻 mp3/m4a… | HTML5 `<audio>` | ✅ | ✅ | 播放頁顯示封面圖示＋標題 |

- 節目資料的 `source`：`youtube`（預設）、`tiktok`、`file`；`file` 另有 `src` 與 `mediaType`。
- 詞匯 key 用節目 `id`：YouTube 用 `videoId`、TikTok 用 `tt_<貼文ID>`、媒體檔用 `f_<URL 短雜湊>`。
- 舊資料（只有 `videoId`）會視為 YouTube，完全相容。
- 目前媒體檔**只支援貼 URL**，尚未提供上載（R2）功能。
- 抖音（Douyin）為「僅供觀看」嵌入，播放頁不顯示詞匯面板。
- 尚未支援：Facebook、Instagram；Vimeo 規劃於 Phase 2。貼上這些連結會顯示明確的「不支援」訊息（不會誤判成 YouTube）。

## 詞匯面板（播放頁）

播放頁右側是「詞匯」面板，依時間片段顯示：

- 詞匯內容**一律由老師提供的 JSON 決定**（每個片段有 `start`／`end`、選填 `en`／`zh` 句子與 `words`）。
- 每個詞顯示為 `原形 (原型)`（例如 `thought (think)`）；點詞會把中文釘在上方固定高度的區塊並**暫停影片**。
- 進度條上方（影片視窗外）顯示該段**字幕**：上行為 `en`、下行 `zh`；拖曳字幕下緣可調整容器高度（會記住）；字級會**依容器高度自動調整**，內容放不下時再縮小，版面不跳動。
- 字幕中的**詞**可互動：點擊會**暫停影片**並在右側詞匯面板顯示該詞翻譯；點字幕空白處則切換播放／暫停。
- 播放時自動跟隨切換片段；`‹ 上一段`／`下一段 ›` 位於進度條下方（快捷鍵 `A`／`D`）；中間標籤顯示目前**段落編號／總段數**（如 `10/108`）。
- 搜尋框輸入詞按 `Enter` → **列出所有含該詞的片段**，點擊任一項即跳到該時段。
- 時間軸需**拖曳指針把手**才能移動位置（點擊軌道空白處不會跳轉）；拖曳時字幕與詞匯會**立即更新**，不受影片載入或緩衝速度影響。

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
| `A` / `D` | 上一段 / 下一段詞匯 |
| `Space` | 播放 / 暫停 |

拖曳進度條指針把手可跳轉（點擊軌道空白處無效）；`‹ 上一段`／`下一段 ›` 在進度條下方；點詞匯 → 暫停並顯示中文；點字幕詞 → 顯示該詞翻譯；點字幕空白處切換播放／暫停。

## 已知限制（V1）

- 詞匯完全取決於老師上載的 JSON；沒有 JSON 時播放頁不顯示任何詞匯。
- 無登入/班級管理；所有學生共用同一清單。
- 首頁「新增影片」不設保護；任何取得網址的人都能新增、覆寫或**刪除**（資料存 KV）。
- 影片若為年齡/地區限制，iframe 可能無法播放（會在頁面顯示錯誤）。
- 媒體檔 URL 需允許直連與 CORS／range，否則讀不到播放時間，詞匯同步會失效。
- TikTok 不支援變速；部分影片可能不允許嵌入。
- 手機／平板（寬 ≤1024px）播放頁不顯示頂部標題列，影片置頂、返回鈕改在影片下方；載入與首次觸控時會嘗試收起瀏覽器網址欄，讓播放視窗貼齊螢幕頂端（實際仍由瀏覽器決定）；小螢幕（寬 ≤760px 或高 ≤520px）會隱藏右側詞匯面板。

## V2 候選方向

- 班級帳號與進度統計；首頁自訂節目的編輯／刪除與排序（目前僅能新增）。
- 詞匯「跟讀／測驗」模式（聽一段 → 選詞義 → 錄音對比）。
- 收藏／筆記（跨影片管理）。
