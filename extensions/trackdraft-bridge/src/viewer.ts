import type { BlueprintSong } from "./blueprint.js";

/**
 * A self-contained, read-only HTML page for `Ui.showModalDialog` showing
 * every field in the blueprints that the "Apply Song Blueprint" CuePoint
 * math throws away: concept, vocal delivery/dynamics/instrumentation
 * notes, and each section's chords/role/transition note. All song data is
 * embedded once as JSON and rendered client-side via `textContent`, so a
 * song title, concept, or note containing HTML/script-breaking characters
 * (real risk here — this text is extracted from prose docx files, not
 * hand-typed) can't affect the page.
 */
export function buildViewerHtml(songs: BlueprintSong[]): string {
  const dataJson = JSON.stringify(songs).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Song Blueprint Viewer</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #222; color: #eee; margin: 0; padding: 0; display: flex; height: 100vh; box-sizing: border-box; }
  #songList { width: 160px; flex: 0 0 auto; overflow-y: auto; border-right: 1px solid #444; padding: 10px; box-sizing: border-box; }
  #detail { flex: 1 1 auto; overflow-y: auto; padding: 14px 18px; box-sizing: border-box; }
  button.song { display: block; width: 100%; text-align: left; background: #333; color: #eee; border: 1px solid #444; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; cursor: pointer; font-size: 12px; }
  button.song.active { background: #4a4a20; border-color: #8a8a30; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #999; margin-bottom: 12px; }
  h3 { font-size: 12px; text-transform: uppercase; color: #aaa; margin: 14px 0 4px; }
  p, li { font-size: 13px; line-height: 1.4; margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #3a3a3a; vertical-align: top; }
  th { color: #999; font-weight: normal; }
  #closeBtn { margin-top: 14px; background: transparent; color: #999; border: 1px solid #444; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  .empty { color: #777; font-size: 12px; }
</style>
</head>
<body>
  <div id="songList"></div>
  <div id="detail"></div>
<script>
  function closeDialog() {
    var message = { method: "close_and_send", params: [""] };
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
      window.webkit.messageHandlers.live.postMessage(message);
    } else if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(message);
    }
  }

  var songs = ${dataJson};
  var listEl = document.getElementById("songList");
  var detailEl = document.getElementById("detail");

  function text(tag, value, className) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    return el;
  }

  function renderDetail(song) {
    detailEl.innerHTML = "";
    detailEl.appendChild(text("h2", song.title || "(untitled)"));

    var metaParts = [];
    if (song.key) metaParts.push(song.key + (song.scale ? " " + song.scale : ""));
    metaParts.push(song.bpm + " bpm");
    detailEl.appendChild(text("div", metaParts.join(" \\u00b7 "), "meta"));

    if (song.concept) {
      detailEl.appendChild(text("h3", "Concept"));
      detailEl.appendChild(text("p", song.concept));
    }

    var notes = song.notes || {};
    if (notes.vocalDelivery) {
      detailEl.appendChild(text("h3", "Vocal Delivery"));
      detailEl.appendChild(text("p", notes.vocalDelivery));
    }
    if (notes.dynamics) {
      detailEl.appendChild(text("h3", "Dynamics"));
      detailEl.appendChild(text("p", notes.dynamics));
    }
    if (notes.instrumentation && notes.instrumentation.length > 0) {
      detailEl.appendChild(text("h3", "Instrumentation"));
      detailEl.appendChild(text("p", notes.instrumentation.join(", ")));
    }
    if (notes.lyricalContent) {
      detailEl.appendChild(text("h3", "Lyrical Content"));
      detailEl.appendChild(text("p", notes.lyricalContent));
    }

    detailEl.appendChild(text("h3", "Sections"));
    var sections = song.sections || [];
    if (sections.length === 0) {
      detailEl.appendChild(text("p", "No sections.", "empty"));
    } else {
      var table = document.createElement("table");
      var thead = document.createElement("tr");
      ["Section", "Role", "Bars", "Chords", "Transition"].forEach(function (h) {
        thead.appendChild(text("th", h));
      });
      table.appendChild(thead);
      sections.forEach(function (section) {
        var row = document.createElement("tr");
        row.appendChild(text("td", section.name || ""));
        row.appendChild(text("td", section.role || ""));
        row.appendChild(text("td", String(section.bars != null ? section.bars : "")));
        var chordText = (section.chords || []).map(function (c) { return c.romanNumeral; }).join(" - ");
        row.appendChild(text("td", chordText));
        row.appendChild(text("td", section.transitionNote || ""));
        table.appendChild(row);
      });
      detailEl.appendChild(table);
    }
  }

  function selectSong(song, btn) {
    Array.prototype.forEach.call(listEl.querySelectorAll(".song"), function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    renderDetail(song);
  }

  if (songs.length === 0) {
    listEl.appendChild(text("p", "No blueprints found.", "empty"));
  } else {
    songs.forEach(function (song, i) {
      var btn = document.createElement("button");
      btn.className = "song";
      btn.textContent = song.title || "(untitled)";
      btn.addEventListener("click", function () { selectSong(song, btn); });
      listEl.appendChild(btn);
      if (i === 0) selectSong(song, btn);
    });
  }

  var closeBtn = document.createElement("button");
  closeBtn.id = "closeBtn";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeDialog);
  listEl.appendChild(closeBtn);
</script>
</body>
</html>`;
}
