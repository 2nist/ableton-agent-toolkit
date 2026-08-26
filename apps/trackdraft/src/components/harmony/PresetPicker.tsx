import { useState } from "react";
import { PRESET_PROGRESSIONS, SCALE_NAMES, MODE_DATA, pitchClass, noteName } from "@music-theory/core";
import type { NoteName, ChordQuality } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

interface PresetPickerProps {
  keyName: NoteName;
  beatsPerChord: number;
  hasChords: boolean;
  sectionName: string;
  onApply: (chords: Chord[]) => void;
  currentChords?: Chord[];
}

const PRESET_ENTRIES = Object.entries(PRESET_PROGRESSIONS);
const STORAGE_KEY = "trackdraft-custom-presets";

/** Family grouping for the preset dropdown — makes the long list scannable
 *  instead of one flat wall. The presets carry no category field, so this
 *  is inferred from the preset key; anything unlisted falls into "More". */
const PRESET_CATEGORY: Record<string, string> = {
  "50s_progression": "Starters",
  pop_progression: "Starters",
  axis_on_vi: "Starters",
  blues: "Starters",
  jazz_turnaround: "Starters",
  one_four_five: "Starters",
  axis_from_IV: "Pop / Axis",
  axis_from_V: "Pop / Axis",
  pop_four: "Pop / Axis",
  pop_five: "Pop / Axis",
  axis_five: "Pop / Axis",
  axis_six: "Pop / Axis",
  jazzy_pop: "Pop / Axis",
  classic_turnaround: "Classic",
  canon: "Classic",
  andalusian: "Modal",
  dorian_funk: "Modal",
  mixolydian_rock: "Modal",
  lydian_float: "Modal",
  phrygian_dark: "Modal",
  modal_rock: "Rock",
  modal_rock_b: "Rock",
  rock_bvi_bvii: "Rock",
};

const PRESET_GROUPS: { label: string; entries: [string, (typeof PRESET_PROGRESSIONS)[string]][] }[] = (() => {
  const groups = new Map<string, [string, (typeof PRESET_PROGRESSIONS)[string]][]>();
  for (const entry of PRESET_ENTRIES) {
    const label = PRESET_CATEGORY[entry[0]] ?? "More";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
})();

interface SavedPreset {
  id: string;
  name: string;
  degrees: string[];
  createdAt: string;
}

function loadCustomPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedPreset[]) : [];
  } catch {
    return [];
  }
}

function saveCustomPresets(presets: SavedPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function degreesToChords(degrees: string[], keyName: NoteName, beatsPerChord: number): Chord[] {
  const keyPc = pitchClass(keyName);
  const mode = MODE_DATA.ionian;
  const chords: Chord[] = [];
  for (const degree of degrees) {
    const bare = degree.replace(/^[♭b♯#]/, "");
    const entry = mode.map[bare] ?? mode.map[degree];
    if (!entry) continue;
    chords.push({
      id: crypto.randomUUID(),
      romanNumeral: degree,
      root: noteName((keyPc + entry.pc) % 12, keyName),
      quality: entry.triad as ChordQuality,
      beats: beatsPerChord,
    });
  }
  return chords;
}

export default function PresetPicker({
  keyName,
  beatsPerChord,
  hasChords,
  sectionName,
  onApply,
  currentChords,
}: PresetPickerProps) {
  const [selected, setSelected] = useState(PRESET_ENTRIES[0][0]);
  const [customPresets, setCustomPresets] = useState<SavedPreset[]>(loadCustomPresets);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [key, preset] = PRESET_ENTRIES.find(([k]) => k === selected)!;

  function handleApplyBuiltin() {
    if (hasChords && !confirm(`Replace ${sectionName}'s progression with "${preset.name}"?`)) return;
    const keyPc = pitchClass(keyName);
    const chords: Chord[] = [];
    for (const degree of preset.degrees) {
      const entry = MODE_DATA[preset.mode].map[degree];
      if (!entry) continue;
      chords.push({
        id: crypto.randomUUID(),
        romanNumeral: degree,
        root: noteName((keyPc + entry.pc) % 12, keyName),
        quality: entry.triad as ChordQuality,
        beats: beatsPerChord,
      });
    }
    onApply(chords);
  }

  function handleApplyCustom(preset: SavedPreset) {
    if (hasChords && !confirm(`Replace ${sectionName}'s progression with "${preset.name}"?`)) return;
    onApply(degreesToChords(preset.degrees, keyName, beatsPerChord));
  }

  function handleSaveCurrent() {
    const name = saveName.trim();
    if (!name || !currentChords || currentChords.length === 0) return;
    const degrees = currentChords.map((c) => c.romanNumeral.replace(/♭/g, "b").replace(/♯/g, "#"));
    if (degrees.length === 0) return;
    const newPreset: SavedPreset = {
      id: crypto.randomUUID(),
      name,
      degrees,
      createdAt: new Date().toISOString(),
    };
    const updated = [...customPresets.filter((p) => p.name !== name), newPreset];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    setSaveName("");
    setShowSave(false);
  }

  function handleDeletePreset(id: string) {
    const updated = customPresets.filter((p) => p.id !== id);
    setCustomPresets(updated);
    saveCustomPresets(updated);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs">
        <select
          className="bg-panelAlt border border-edge rounded px-1.5 py-1 text-ink"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          title={`${preset.degrees.join(" – ")} in ${SCALE_NAMES[preset.mode]}`}
        >
          {PRESET_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.entries.map(([k, p]) => (
                <option key={k} value={k}>{p.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="bg-accent text-black font-medium px-2 py-1 rounded" onClick={handleApplyBuiltin}>
          Apply preset
        </button>
      </div>

      <div className="border-t border-edge/50 pt-2 space-y-1.5">
        {currentChords && currentChords.length > 0 && (
          <div>
            {!showSave ? (
              <button className="text-[11px] text-inkMuted hover:text-accent font-mono" onClick={() => setShowSave(true)}>
                💾 Save current progression…
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  className="flex-1 bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-[11px] text-ink"
                  placeholder="Preset name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveCurrent()}
                  autoFocus
                />
                <button
                  className="bg-accent text-black text-[11px] font-medium px-2 py-0.5 rounded"
                  onClick={handleSaveCurrent}
                  disabled={!saveName.trim()}
                >
                  Save
                </button>
                <button className="text-[11px] text-inkMuted hover:text-ink" onClick={() => { setShowSave(false); setSaveName(""); }}>
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {customPresets.length > 0 && (
          <div className="space-y-1">
            {customPresets.map((p) => (
              <div key={p.id} className="flex items-center gap-1 text-[11px]">
                <button
                  className="flex-1 text-left bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-inkMuted hover:text-ink hover:border-accent/40 truncate"
                  title={`${p.degrees.join(" – ")} · saved ${new Date(p.createdAt).toLocaleDateString()}`}
                  onClick={() => handleApplyCustom(p)}
                >
                  {p.name}
                </button>
                <button className="text-inkMuted hover:text-red-400 px-0.5" title="Delete preset" onClick={() => handleDeletePreset(p.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}