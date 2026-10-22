import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { initialize, MidiTrack, type ActivationContext, type Handle, type NoteDescription } from "@ableton-extensions/sdk";
import { applyOutputOffset, cuePointNamesFor, planCuePoints, sectionSpans, type BlueprintSong } from "./blueprint.js";
import { planChordClips } from "./chordClips.js";
import { planDrumClips } from "./drumClips.js";
import { planBassLine } from "./bassLine.js";
import { planColorClips } from "./colorClips.js";
import { buildPickerHtml } from "./picker.js";
import { buildViewerHtml } from "./viewer.js";
import {
  canLongPoll,
  claimQueuedCommandFile,
  commandUrl,
  describeRuntime,
  listQueuedCommandFiles,
  parseNextResponse,
  DEFAULT_POLL_WAIT_MS,
  type QueuedCommand,
} from "./commandTransport.js";
import {
  buildProbeHtml,
  CLOSE_SCRIPT,
  findDrumRack,
  findDrumRackWithKitFallback,
  probeDrumRack,
  resolvePadMapping,
  remapPitch,
} from "@drum/rack-kit";

const APPLY_COMMAND_ID = "trackdraftBridge.applySongBlueprint";
const VIEW_COMMAND_ID = "trackdraftBridge.viewSongBlueprint";
const GENERATE_CHORDS_COMMAND_ID = "trackdraftBridge.generateChordClips";
const GENERATE_DRUMS_COMMAND_ID = "trackdraftBridge.generateDrumClips";
const GENERATE_BASS_COMMAND_ID = "trackdraftBridge.generateBassLine";
const GENERATE_BLANK_COMMAND_ID = "trackdraftBridge.generateBlankClips";
const PROBE_DRUM_RACK_COMMAND_ID = "trackdraftBridge.probeDrumRack";

/** Interval for the file-based command queue (ms) — the fallback transport,
 *  and what an older Live build is stuck with. */
const COMMAND_POLL_MS = 2000;
/** Gap before retrying the long-poll after falling back, so a bridge started
 *  later is picked up without giving up on the fast path forever. */
const LONG_POLL_RETRY_MS = 30_000;

interface ClipPlanEntry {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

// Extensions run under a restricted filesystem permission model and may
// only read/write context.environment.storageDirectory/tempDirectory —
// reading arbitrary paths (e.g. apps/trackdraft/scripts/output directly)
// is unsupported and crashes the extension host outside dev mode. Blueprint
// JSON files need to be synced into this directory first — see
// scripts/sync-blueprints.sh.
function blueprintDir(storageDirectory: string | undefined): string | undefined {
  return storageDirectory ? path.join(storageDirectory, "blueprints") : undefined;
}

function loadBlueprints(storageDirectory: string | undefined): BlueprintSong[] {
  const dir = blueprintDir(storageDirectory);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".trackdraft.json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as BlueprintSong)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.ui.registerContextMenuAction("MidiTrack", "Apply Song Blueprint", APPLY_COMMAND_ID);
  context.ui.registerContextMenuAction("AudioTrack", "Apply Song Blueprint", APPLY_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "View Song Blueprint", VIEW_COMMAND_ID);
  context.ui.registerContextMenuAction("AudioTrack", "View Song Blueprint", VIEW_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Chord Clips", GENERATE_CHORDS_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Drum Clips", GENERATE_DRUMS_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Bass Line", GENERATE_BASS_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Blank Section Clips", GENERATE_BLANK_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Probe Drum Rack", PROBE_DRUM_RACK_COMMAND_ID);

  // A thrown/rejected command handler kills the whole extension host
  // process (observed directly: one bad fs call took both registered
  // commands out until Live relaunched it) — catch and log instead of
  // letting that happen again.
  const guard =
    (handler: (...args: unknown[]) => Promise<void>) =>
    async (...args: unknown[]) => {
      try {
        await handler(...args);
      } catch (error) {
        console.error("[trackdraft-bridge]", error);
      }
    };

  // Shared by every command that needs a song: show the picker, return the
  // chosen blueprint or undefined if the dialog was cancelled/closed.
  async function pickBlueprint(blueprints: BlueprintSong[]): Promise<BlueprintSong | undefined> {
    const picker = blueprints.map((b) => ({ id: b.id, title: b.title }));
    const dataUrl = `data:text/html,${encodeURIComponent(buildPickerHtml(picker))}`;
    const picked = await context.ui.showModalDialog(dataUrl, 420, 480);
    if (!picked) return undefined;
    return blueprints.find((b) => b.id === picked);
  }

  // Shared by every "one clip per section" command (chords/drums/bass/
  // blank): clears the track's span first so re-running replaces the
  // previous result instead of piling up overlapping clips — clips don't
  // carry a stable identity to dedupe by name the way CuePoints do, so
  // the whole range is cleared instead.
  //
  // `offsetBeats` is the song's rendered-output offset
  // (BlueprintSong.outputOffsetBeats): negative moves everything earlier
  // against the record. `applyOutputOffset` shifts the clip positions,
  // shifting notes inside a first clip that can't start before bar 1.
  async function applyClipPlan(track: MidiTrack<"1.0.0">, plan: ClipPlanEntry[], offsetBeats = 0) {
    if (plan.length === 0) return;
    const shifted = applyOutputOffset(plan, offsetBeats);
    const last = shifted[shifted.length - 1];
    // Clear far enough back for BOTH the unshifted and shifted spans — a
    // prior run without the offset may have placed clips past the new end.
    const unshiftedEnd = plan[plan.length - 1].startBeat + plan[plan.length - 1].durationBeats;
    const totalBeats = Math.max(unshiftedEnd, last.startBeat + last.durationBeats);

    await context.withinTransaction(() => track.clearClipsInRange(0, totalBeats));

    // Two sequential transactions, per the SDK's documented guidance: an
    // object can't be created and have its properties modified in the
    // same transaction block.
    const clips = await context.withinTransaction(() => {
      return Promise.all(shifted.map((entry) => track.createMidiClip(entry.startBeat, entry.durationBeats)));
    });

    await context.withinTransaction(() => {
      clips.forEach((clip, i) => {
        clip.name = shifted[i].name;
        clip.notes = shifted[i].notes;
      });
    });
  }

  function resolveMidiTrack(args: unknown[]): MidiTrack<"1.0.0"> | undefined {
    const [trackHandle] = args;
    return context.getObjectFromHandle(trackHandle as Handle, MidiTrack) ?? undefined;
  }

  /**
   * Finds an existing MIDI track named exactly `name` (case-insensitive), or
   * creates a fresh one — so repeatedly applying a blueprint from the browser
   * (the command-queue path, not the manual per-track context-menu commands)
   * reuses the same three tracks instead of piling up duplicates on every
   * "Send to Ableton". Naming happens directly after creation, unwrapped —
   * same pattern `progression-studio`'s extension already uses for this,
   * unlike clip creation/mutation which the SDK requires as two separate
   * transactions.
   */
  /** Normalize a track name for comparison — trim, lowercase, collapse
   *  internal whitespace so "chord " and " Chord" both match "chord". */
  function normalizedName(n: string): string {
    return (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  /** Alias lists per stem — the template's canonical name first, then the
   *  looser names a user's set might still use (e.g. "Chords" from pre-
   *  template pushes, "Drums"/"Drum Rack" for the kit track). Matched in
   *  order, so the canonical name always wins when both exist (e.g. crave
   *  is preferred over a plain "bass" track). */
  const STEM_ALIASES: Record<string, string[]> = {
    kit: ["kit", "drums", "drum"],
    crave: ["crave", "bass"],
    chord: ["chord", "chords"],
    color: ["color", "colour"],
  };

  async function findOrCreateMidiTrack(name: string): Promise<MidiTrack<"1.0.0">> {
    const song = context.application.song;
    const midiTracks = song.tracks.filter((t): t is MidiTrack<"1.0.0"> => t instanceof MidiTrack);
    const aliases = STEM_ALIASES[name] ?? [name];

    // 1) Exact normalized match, alias in preference order.
    for (const a of aliases) {
      const hit = midiTracks.find((t) => normalizedName(t.name) === a);
      if (hit) {
        console.log(`[trackdraft-bridge] findOrCreateMidiTrack("${name}") → reused "${hit.name}"`);
        return hit;
      }
    }
    // 2) Word-boundary fallback: "chord 2", "my chord", "Drum Rack", ...
    for (const a of aliases) {
      const hit = midiTracks.find((t) => {
        const n = normalizedName(t.name);
        return n === a || n.startsWith(`${a} `) || n.includes(` ${a} `) || n.endsWith(` ${a}`);
      });
      if (hit) {
        console.log(`[trackdraft-bridge] findOrCreateMidiTrack("${name}") → fuzzy-matched "${hit.name}"`);
        return hit;
      }
    }

    const existing = midiTracks.map((t) => `"${t.name}"`).join(", ");
    console.log(
      `[trackdraft-bridge] findOrCreateMidiTrack("${name}") → no match, creating. Existing MIDI tracks: ${existing || "(none)"}`,
    );
    const track = await song.createMidiTrack();
    track.name = name;
    return track;
  }

  /**
   * Real pad mapping for a track, falling back to the project's `kit`
   * track when the target itself has no DrumRack — returns an empty
   * mapping (no remapping applied) when neither has one, rather than
   * failing the whole "Generate Drum Clips" command over a missing rack.
   */
  async function resolveTrackPadMapping(track: MidiTrack<"1.0.0">) {
    const song = context.application.song;
    const rack = song ? findDrumRackWithKitFallback(track, song) : findDrumRack(track);
    if (!rack) return {};
    const report = await probeDrumRack(track, rack);
    return resolvePadMapping(report);
  }

  /**
   * Remaps every note's pitch in a clip plan through a resolved pad mapping.
   * No-op for an empty mapping — and, as things stand, also a no-op for any
   * *non*-empty mapping `resolvePadMapping` can currently produce (see its
   * docstring in `@drum/rack-kit`): it can only confirm a pad already sits
   * at its assumed note, never discover it sitting somewhere else. Kept
   * wired so a future role-classification improvement to `resolvePadMapping`
   * (e.g. from sample names) doesn't need new plumbing here.
   */
  function remapClipPlanPitches(plan: ClipPlanEntry[], mapping: ReturnType<typeof resolvePadMapping>): ClipPlanEntry[] {
    if (Object.keys(mapping).length === 0) return plan;
    return plan.map((entry) => ({
      ...entry,
      notes: entry.notes.map((note) => ({ ...note, pitch: remapPitch(note.pitch, mapping) })),
    }));
  }

  // Reports a loaded Drum Rack's real pad layout and velocity parameters.
  // Read-only by design: it answers what the rack is, and changes nothing.
  context.commands.registerCommand(
    PROBE_DRUM_RACK_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;

      const rack = findDrumRack(track);
      if (!rack) {
        const message = `<!doctype html><meta charset="utf-8">
<body style="font:13px system-ui;background:#1a1a1a;color:#ddd;padding:20px;margin:0">
<p>No Drum Rack on track "${track.name}" — checked its full device chain, including inside other racks.</p>
<button id="closeBtn" style="margin-top:10px;background:transparent;color:#999;border:1px solid #444;border-radius:4px;padding:5px 12px;cursor:pointer;font:inherit">Close</button>
<script>${CLOSE_SCRIPT}</script>
</body>`;
        await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(message)}`, 460, 180);
        return;
      }

      const report = await probeDrumRack(track, rack);
      console.log("[trackdraft-bridge] drum rack probe", JSON.stringify(report, null, 2));
      const dataUrl = `data:text/html,${encodeURIComponent(buildProbeHtml(report))}`;
      await context.ui.showModalDialog(dataUrl, 860, 620);
    }),
  );

  context.commands.registerCommand(
    VIEW_COMMAND_ID,
    guard(async () => {
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const dataUrl = `data:text/html,${encodeURIComponent(buildViewerHtml(blueprints))}`;
      await context.ui.showModalDialog(dataUrl, 640, 560);
    }),
  );

  context.commands.registerCommand(
    APPLY_COMMAND_ID,
    guard(async () => {
      const song = context.application.song;
      if (!song) return;

      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;

      const plan = planCuePoints(blueprint);
      const namesToReplace = cuePointNamesFor(blueprint);
      const staleCuePoints = song.cuePoints.filter((cuePoint) => namesToReplace.has(cuePoint.name));

      if (staleCuePoints.length > 0) {
        await context.withinTransaction(() => {
          return Promise.all(staleCuePoints.map((cuePoint) => song.deleteCuePoint(cuePoint)));
        });
      }

      // Two sequential transactions, per the SDK's documented guidance: an
      // object can't be created and have its properties modified in the
      // same transaction block.
      const cuePoints = await context.withinTransaction(() => {
        return Promise.all(plan.map((entry) => song.createCuePoint(entry.beat)));
      });

      await context.withinTransaction(() => {
        cuePoints.forEach((cuePoint, i) => {
          cuePoint.name = plan[i].name;
        });
        song.tempo = blueprint.bpm;
      });
    }),
  );

  context.commands.registerCommand(
    GENERATE_CHORDS_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      await applyClipPlan(track, planChordClips(blueprint), blueprint.outputOffsetBeats ?? 0);
    }),
  );

  context.commands.registerCommand(
    GENERATE_DRUMS_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      const plan = planDrumClips(blueprint);
      const mapping = await resolveTrackPadMapping(track);
      await applyClipPlan(track, remapClipPlanPitches(plan, mapping), blueprint.outputOffsetBeats ?? 0);
    }),
  );

  context.commands.registerCommand(
    GENERATE_BASS_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      await applyClipPlan(track, planBassLine(blueprint), blueprint.outputOffsetBeats ?? 0);
    }),
  );

  context.commands.registerCommand(
    GENERATE_BLANK_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      const plan = sectionSpans(blueprint).map(({ section, startBeat, durationBeats }) => ({
        name: section.name,
        startBeat,
        durationBeats,
        notes: [],
      }));
      await applyClipPlan(track, plan, blueprint.outputOffsetBeats ?? 0);
    }),
  );

  // --- File-based command queue polling ---
  //
  // The osc-bridge's /api/command endpoint writes JSON payloads to
  // storageDirectory/blueprints/queue/.  This loop reads and deletes
  // them so the browser app can trigger actions (set tempo, apply a
  // blueprint, generate clips) without a user right-clicking a track
  // in Live.  Each file's shape is intentionally envelope-only:
  // { action: "applyBlueprint", blueprintId: "…" } or
  // { action: "setTempo", bpm: 140 } — the action key is mandatory.
  const queueDir = context.environment.storageDirectory
    ? path.join(context.environment.storageDirectory, "blueprints", "queue")
    : undefined;

  /** Run one queued command. Shared by both transports, so the fast path and
   *  the fallback can never drift apart in behaviour. */
  async function executeQueuedCommand(payload: QueuedCommand) {
    switch (payload.action) {
      case "setTempo": {
        const song = context.application.song;
        const bpm = typeof payload.bpm === "number" ? payload.bpm : null;
        if (song && bpm !== null && bpm > 0 && bpm <= 999) {
          await context.withinTransaction(() => {
            song.tempo = bpm;
          });
          console.log(`[trackdraft-bridge] queue: tempo → ${bpm}`);
        }
        break;
      }
      case "applyBlueprint": {
        const song = context.application.song;
        if (!song || typeof payload.blueprintId !== "string") break;
        const blueprint = loadBlueprints(context.environment.storageDirectory).find(
          (b) => b.id === payload.blueprintId,
        );
        if (!blueprint) break;

        const cuePlan = planCuePoints(blueprint);
        const names = cuePointNamesFor(blueprint);
        const stale = song.cuePoints.filter((c) => names.has(c.name));

        await context.withinTransaction(() =>
          Promise.all(stale.map((c) => song.deleteCuePoint(c))),
        );
        const created = await context.withinTransaction(() =>
          Promise.all(cuePlan.map((e) => song.createCuePoint(e.beat))),
        );
        await context.withinTransaction(() => {
          created.forEach((c, i) => (c.name = cuePlan[i].name));
          song.tempo = blueprint.bpm;
        });

        // Real playable MIDI, not just markers — the whole point of
        // triggering this from the browser instead of requiring the user
        // to right-click three separate tracks inside Live and pick the
        // blueprint from a dialog each time. Reuses the exact same
        // generators/clearing logic the manual "Generate X Clips" commands
        // already use, just aimed at the template set's named tracks
        // (lowercase `kit`/`crave`/`chord`/`color`) instead of whatever
        // track the user right-clicked — `findOrCreateMidiTrack` matches
        // case-insensitively, so the template's existing tracks get
        // reused rather than duplicated.
        const chordsTrack = await findOrCreateMidiTrack("chord");
        await applyClipPlan(chordsTrack, planChordClips(blueprint), blueprint.outputOffsetBeats ?? 0);

        const bassTrack = await findOrCreateMidiTrack("crave");
        await applyClipPlan(bassTrack, planBassLine(blueprint), blueprint.outputOffsetBeats ?? 0);

        const drumsTrack = await findOrCreateMidiTrack("kit");
        const drumMapping = await resolveTrackPadMapping(drumsTrack);
        await applyClipPlan(drumsTrack, remapClipPlanPitches(planDrumClips(blueprint), drumMapping), blueprint.outputOffsetBeats ?? 0);

        const colorTrack = await findOrCreateMidiTrack("color");
        await applyClipPlan(colorTrack, planColorClips(blueprint), blueprint.outputOffsetBeats ?? 0);

        console.log(`[trackdraft-bridge] queue: applied blueprint "${blueprint.title}" (cue points + chord/crave/kit/color)`);
        break;
      }
    }
  }

  /** Fallback transport: sweep the queue directory. Still the only option on
   *  a Live older than 12.4.15b5, and the safety net if the bridge is down. */
  async function drainQueueDirectory() {
    if (!queueDir) return 0;
    let executed = 0;
    for (const file of listQueuedCommandFiles(queueDir)) {
      const payload = claimQueuedCommandFile(queueDir, file);
      if (!payload) continue;
      await executeQueuedCommand(payload);
      executed += 1;
    }
    return executed;
  }

  /** Fast transport: park on the bridge until it hands over a command. */
  async function fetchQueuedCommand(): Promise<QueuedCommand | null> {
    const response = await fetch(commandUrl(undefined, DEFAULT_POLL_WAIT_MS), {
      signal: AbortSignal.timeout(DEFAULT_POLL_WAIT_MS + 5_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    return parseNextResponse(await response.json());
  }

  const runtime = describeRuntime();
  console.log(
    `[trackdraft-bridge] runtime globals: ${Object.entries(runtime)
      .map(([name, present]) => `${name}=${present ? "yes" : "no"}`)
      .join(" ")}`,
  );

  let longPoll = canLongPoll(runtime);
  if (!longPoll) {
    console.log(
      "[trackdraft-bridge] long-poll unavailable (needs fetch + AbortSignal.timeout, Live 12.4.15b5 or newer) — scanning the queue directory every " +
        `${COMMAND_POLL_MS} ms`,
    );
  }

  /** One transport cycle. Never throws: a command handler that rejects must
   *  not take the loop (or the extension host) with it. */
  async function pumpCommands(): Promise<void> {
    if (longPoll) {
      try {
        const command = await fetchQueuedCommand();
        if (command) await executeQueuedCommand(command);
        return;
      } catch (error) {
        console.log(`[trackdraft-bridge] long-poll failed (${String(error)}); scanning the queue directory instead`);
        longPoll = false;
        // Commands may have queued up while the bridge was unreachable.
        await drainQueueDirectory();
        return;
      }
    }

    const executed = await drainQueueDirectory();
    if (executed > 0) return;
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
  }

  // A single self-scheduling loop rather than setInterval: a long-poll blocks
  // for ~20 s by design, so a fixed interval would stack overlapping requests.
  // It runs for the life of the extension host — the SDK has no deactivate
  // hook — and never throws out of itself, because an unhandled rejection
  // takes the whole host down.
  let lastLongPollAttempt = Date.now();
  void (async function commandLoop() {
    for (;;) {
      try {
        await pumpCommands();
      } catch (error) {
        console.error("[trackdraft-bridge] command loop:", error);
        await sleep(COMMAND_POLL_MS);
      }
      // Re-probe the fast path periodically, so a bridge started after Live
      // is picked up without a relaunch.
      if (!longPoll && Date.now() - lastLongPollAttempt > LONG_POLL_RETRY_MS) {
        lastLongPollAttempt = Date.now();
        longPoll = canLongPoll(runtime);
      }
    }
  })();
}
