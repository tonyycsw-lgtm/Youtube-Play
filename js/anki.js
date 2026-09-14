/* ============================================================
   匯出模組：A-B 區間字幕卡片（剪貼簿複製 + Anki 相容 CSV）
   ============================================================ */
window.AnkiExport = (function () {
  'use strict';

  /* A-B 區間字幕交集（含 0.1s 緩衝，防止字尾斷頭） */
  function subtitleRange(subtitles, timeA, timeB, buffer) {
    const buf = buffer == null ? 0.1 : buffer;
    return (subtitles || []).filter(function (s) {
      return s.start < timeB + buf && s.end > timeA - buf;
    });
  }

  function buildCard(info) {
    const matched = subtitleRange(info.subtitles, info.timeA, info.timeB);
    const text = matched
      .map(function (s) { return s.text.trim(); })
      .filter(Boolean)
      .join('\n');

    const front = text || '[此區間無字幕，請手動輸入]';
    const back =
      info.title + '\n' +
      info.formatTime(info.timeA) + ' - ' + info.formatTime(info.timeB) + '\n' +
      'https://youtu.be/' + info.videoId + '?start=' + Math.round(info.timeA) + '&end=' + Math.round(info.timeB);

    return { front: front, back: back };
  }

  /* ---------- 剪貼簿複製（含舊瀏覽器降級） ---------- */
  async function copyCard(card) {
    const payload = 'Front:\n' + card.front + '\n\nBack:\n' + card.back + '\n\nTags: UTube_UP_Premium, YouTube_Language_Flow';
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = payload;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- CSV 下載（Anki 匯入用，含 BOM 供 Excel） ---------- */
  function csvCell(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  function downloadCSV(card, videoId) {
    const rows = [
      ['Front', 'Back', 'Tags'].map(csvCell).join(','),
      csvCell(card.front) + ',' + csvCell(card.back) + ',' + csvCell('UTube_UP_Premium YouTube_Language_Flow')
    ];
    const csv = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (videoId || 'segment') + '-card.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  return { subtitleRange: subtitleRange, buildCard: buildCard, copyCard: copyCard, downloadCSV: downloadCSV };
})();
