export interface PickerSong {
  id: string;
  title: string;
}

/**
 * A self-contained HTML page for `Ui.showModalDialog`. Song titles are
 * inserted via `textContent`, not string-interpolated markup, so a title
 * containing HTML/script-breaking characters can't affect the page. The
 * embedded JSON blob escapes `<` so a title containing "</script>" can't
 * terminate the script block early either.
 */
export function buildPickerHtml(songs: PickerSong[]): string {
  const dataJson = JSON.stringify(songs).replace(/</g, "\\u003c");
  const body =
    songs.length === 0
      ? `<p>No song blueprints found. Ingest/export one from TrackDraft first.</p>`
      : `<div id="list"></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Select Song Blueprint</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #222; color: #eee; margin: 0; padding: 16px; }
  h2 { font-size: 14px; margin: 0 0 12px; }
  button.song { display: block; width: 100%; text-align: left; background: #333; color: #eee; border: 1px solid #444; border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; font-size: 13px; }
  button.song:hover { background: #3d3d3d; }
  button#cancel { margin-top: 12px; background: transparent; color: #999; border: none; cursor: pointer; }
</style>
</head>
<body>
  <h2>Apply Song Blueprint &mdash; choose a song</h2>
  ${body}
  <button id="cancel">Cancel</button>
<script>
  function closeWithResult(result) {
    var message = { method: "close_and_send", params: [result] };
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
      window.webkit.messageHandlers.live.postMessage(message);
    } else if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(message);
    }
  }
  var songs = ${dataJson};
  var list = document.getElementById("list");
  if (list) {
    songs.forEach(function (song) {
      var btn = document.createElement("button");
      btn.className = "song";
      btn.textContent = song.title;
      btn.addEventListener("click", function () { closeWithResult(song.id); });
      list.appendChild(btn);
    });
  }
  document.getElementById("cancel").addEventListener("click", function () { closeWithResult(""); });
</script>
</body>
</html>`;
}
