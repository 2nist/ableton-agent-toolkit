/**
 * Renderer-side half of `TRACKDRAFT_SMOKE=1 npx electron .`.
 *
 * A real file rather than a template literal inside main.cjs: escaping a regex
 * or a newline through a JS template string silently mangles it (the first
 * version replaced the letter "s" because `\s` collapsed, the second threw on a
 * literal newline inside a regex). Reading this file and executing it removes
 * that whole class of mistake.
 *
 * The expression must evaluate to a JSON-serialisable object.
 */
(async () => {
  const host = window.trackdraft;
  const out = {
    href: location.href,
    origin: location.origin,
    hostname: location.hostname,
    title: document.title,
    hasHost: Boolean(host),
    keys: host ? Object.keys(host) : [],
  };

  if (!host) return out;

  const library = await host.libraryLoad();
  out.library = {
    count: library.songs.length,
    seeded: library.seeded,
    unreadable: library.unreadable,
    dir: library.dir,
    distribution: library.distribution,
  };

  /**
   * Is a specific library song actually on screen?
   *
   * Deliberately NOT the "All Songs" figure in the left rail: that counts the
   * dev server's directory listings, which do not exist in a packaged build,
   * so it reads 0 no matter how many songs the library holds.
   */
  const firstTitle = (library.songs[0] && library.songs[0].title) || "";
  const songIsOnScreen = () => {
    if (!firstTitle) return false;
    return String(document.body.innerText || "").includes(firstTitle);
  };

  // Reading 182 files and 11 MB of JSON is not instant, so poll instead of
  // guessing a wait.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !songIsOnScreen()) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // The dashboard's top-left is bare, so its sidebar reserves vertical room
  // for the window buttons instead of horizontal room.
  const sidebarNav = document.querySelector("aside nav");
  out.sidebarInsetTop = sidebarNav ? getComputedStyle(sidebarNav).paddingTop : null;

  out.firstLibraryTitle = firstTitle;
  out.libraryShownInUi = songIsOnScreen();
  out.rowsInSongTable = document.querySelectorAll("tbody tr").length;
  out.bodyText = String(document.body.innerText || "").slice(0, 200);

  /* ── the workbench (Studio was retired into it) ────────────────────────
   * Opening a song is a same-document SPA navigation, so this probe keeps
   * running across it. Checks the two things the phase-out had to preserve:
   * the arrangement surface and the sync controls. */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Rows navigate on click (no anchor), so drive the table itself.
  const songRow = document.querySelector("tbody tr");
  out.songRowFound = Boolean(songRow);
  if (songRow) {
    songRow.click();
    const routeDeadline = Date.now() + 5000;
    while (Date.now() < routeDeadline && !location.pathname.includes("/song/")) await wait(100);
    await wait(600);
    out.route = location.pathname;

    const buttons = [...document.querySelectorAll("button")];
    const label = (b) => String(b.textContent || "").trim();
    out.workbenchSurfaces = buttons.map(label).filter((t) => t === "Section" || t === "Arrangement");
    out.settingsOnSongRoute = Boolean(
      [...document.querySelectorAll("select")].some((s2) => /ionian|dorian|lydian/.test(String(s2.value))),
    );
    // Sync is a facet on the right rail (icon-only until the rail is opened).
    out.syncFacet = Boolean(document.querySelector('[title*="Sync"]'));
    // The retired view must be gone from the nav, not merely unrouted.
    out.studioInNav = [...document.querySelectorAll("aside a")].some((a) => /\bStudio\b/.test(label(a)));

    const arrangement = buttons.find((b) => label(b) === "Arrangement");
    if (arrangement) {
      arrangement.click();
      await wait(500);
      out.arrangementRendered = document.body.innerText.length > 200;
      out.arrangementHasConsole = /chords|melody|drums/i.test(document.body.innerText);
      // The console's drums pane must show the sequencer, not an empty box.
      const grid = document.querySelector('[title^="Step sequencer"]');
      out.stepGridLanes = grid ? grid.querySelectorAll("div > div").length : 0;
      const drumsPane = [...document.querySelectorAll("section")].find((sec) =>
        /\bDrums\b/.test(sec.querySelector("header") ? sec.querySelector("header").innerText : ""),
      );
      out.drumsPaneText = drumsPane ? drumsPane.innerText.replace(/\s+/g, " ").slice(0, 120) : null;
    }

    /* A song that actually has drums: the console must show the INFERRED
     * pattern (role-based), not a single hardcoded groove. Read from the
     * library rather than a hardcoded id so this survives a new catalogue. */
    const withDrums = (library.songs || []).find((song) =>
      (song.sections || []).some((sec) => sec.drumPattern !== "none"),
    );
    if (withDrums) {
      history.pushState({}, "", `/song/${withDrums.id}/workbench`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(1200);
      const grid = document.querySelector('[title^="Step sequencer"]');
      const pane = [...document.querySelectorAll("section")].find((sec) =>
        /\bDrums\b/.test(sec.querySelector("header") ? sec.querySelector("header").innerText : ""),
      );
      out.liveSong = withDrums.id;
      out.liveDrumsHint = pane ? pane.querySelector("header").innerText.replace(/\s+/g, " ").trim() : null;
      out.liveGridTitle = grid ? grid.getAttribute("title") : null;
      out.liveGridPreview = grid ? /preview/.test(grid.getAttribute("title") || "") : null;
    }

    // The macOS window buttons are drawn inside the page, so the strip that
    // holds ← and the title has to reserve room for them.
    const strip = document.querySelector("[data-spine] > div");
    out.spineInset = strip ? getComputedStyle(strip).paddingLeft : null;
  }

  /* Engine tables: which LAYER each one is coming from (shipped / library file
   * / this song's override). The boot assertions above cannot see this, and a
   * song override that fails to apply looks exactly like one that was never
   * written. */
  const settingsSong = (library.songs[0] || {}).id;
  history.pushState({}, "", `/song/${settingsSong}/settings`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await wait(1400);
  const dataFiles = [...document.querySelectorAll("section")].find((sec) =>
    /data files/i.test(sec.innerText || ""),
  );
  out.dataFiles = dataFiles ? dataFiles.innerText.replace(/\s+/g, " ").slice(0, 260) : null;

  // The path guard must refuse a read the user never granted.
  try {
    await host.readText("/etc/passwd");
    out.ungrantedRead = "ALLOWED (bug)";
  } catch (error) {
    out.ungrantedRead = String((error && error.message) || error).slice(0, 100);
  }

  return out;
})();
