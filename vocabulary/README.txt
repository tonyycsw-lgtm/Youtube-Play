詞匯檔（JSON）說明
==================

把詞匯檔放在這個 vocabulary/ 資料夾，檔名 = 影片 ID：

    vocabulary/{videoId}.json

例如示範影片（videoId: gj1v-L1bEQc）的詞匯檔就是：

    vocabulary/gj1v-L1bEQc.json

播放頁會自動讀取這個檔；找不到時會即時從字幕抽取英文詞（沒有中文）。

格式（UTF-8）：

    {
      "videoId": "gj1v-L1bEQc",
      "window": 10,
      "segments": [
        {
          "start": 0,
          "end": 14,
          "words": [
            { "w": "magic", "zh": "魔法" },
            { "w": "stone", "zh": "石頭" }
          ]
        }
      ]
    }

| 欄位 | 說明 |
|---|---|
| `start` / `end` | 這段影片的起訖秒數（段落＝把連續字幕句合併到約 window 秒） |
| `window` | 產生時使用的段落長度（秒），僅供參考 |
| `words[].w` | 英文詞（已轉小寫、去停用詞、基本詞形合併） |
| `words[].zh` | 繁體中文翻譯（可留空，播放頁會顯示「尚無中文翻譯」） |

產生方式：用「字幕工具」（srt-tool.html）步驟 5「產生詞匯表」，
自動切段、斷詞、翻譯初稿，老師可刪除/修改後下載 JSON，放到本資料夾再 push。
也可在 programs.json 的節目用 "vocab" 欄位指定其他路徑。
