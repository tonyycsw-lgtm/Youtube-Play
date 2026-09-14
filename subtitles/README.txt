字幕檔（SRT）上傳說明
======================

把字幕檔放在這個 subtitles/ 資料夾，檔名 = 影片 ID：

    subtitles/{videoId}.srt

例如示範影片（videoId: gj1v-L1bEQc）的字幕檔就是：

    subtitles/gj1v-L1bEQc.srt

SRT 優先於自動抓取：只要有這個檔，播放頁一定用它（老師可校正 YouTube 自動字幕的錯誤）。

也可在 programs.json 的節目中用 "srt" 欄位指定其他路徑，例如：
    "srt": "subtitles/xiyouji-corrected.srt"

格式範例（UTF-8 編碼，建議使用 Notepad++ / VS Code 儲存）：

    1
    00:00:01,200 --> 00:00:04,000
    Long long ago, a magic stone gave birth to a monkey.

    2
    00:00:04,500 --> 00:00:08,100
    Everyone called him the Monkey King.

取得 SRT 的方法：
  1. 影片有 YouTube 自動字幕時，可在網路上搜尋「YouTube 字幕下載」工具匯出（.srt / .vtt 皆可，.vtt 請另存為 .srt 格式）。
  2. 或手動逐句輸入（適合短片段教材）。
