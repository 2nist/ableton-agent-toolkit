import { useSongStore } from "../../store/songStore";
import type { AlternateDraft, ProductionStatus, Provenance } from "../../types/blueprint";

const SOURCE_LABEL: Record<Provenance["source"], string> = {
  manual: "Manual entry",
  "docx-ingest": "Ingested from docx/xlsx source material",
  "audio-extract": "Extracted from audio",
  "midi-import": "Imported from MIDI",
  "catalog-lookup": "Matched from a known-song chord/lyric catalog",
};

function ProvenanceBanner({ provenance }: { provenance: Provenance }) {
  if (provenance.source === "manual") return null;
  return (
    <div className="border border-amber-700/40 bg-amber-950/20 rounded p-2 space-y-1">
      <p className="text-2xs font-medium text-amber-400">
        {SOURCE_LABEL[provenance.source]} — draft, review before finalizing
      </p>
      {provenance.warnings && provenance.warnings.length > 0 && (
        <ul className="text-3xs text-amber-200/80 list-disc list-inside space-y-0.5">
          {provenance.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block space-y-0.5">
      <span className="text-3xs text-inkMuted uppercase tracking-wide">{label}</span>
      {multiline ? (
        <textarea
          className="w-full bg-panelAlt border border-edge rounded px-1.5 py-1 text-2xs resize-y min-h-[40px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="w-full bg-panelAlt border border-edge rounded px-1.5 py-1 text-2xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function ListField({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex gap-1">
          <input
            className="flex-1 bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-2xs"
            value={item}
            onChange={(e) => onChange(items.map((it, j) => (j === i ? e.target.value : it)))}
          />
          <button
            className="text-2xs text-inkMuted hover:text-red-400 px-1"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="text-2xs border border-edge rounded px-1.5 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt"
        onClick={() => onChange([...items, ""])}
      >
        + Add
      </button>
      {items.length === 0 && <p className="text-2xs text-inkMuted">{placeholder}</p>}
    </div>
  );
}

function AlternatesEditor({
  alternates,
  onChange,
}: {
  alternates: AlternateDraft[];
  onChange: (alternates: AlternateDraft[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {alternates.map((alt, i) => (
        <div key={i} className="border border-edge rounded p-1.5 space-y-1">
          <div className="flex gap-1">
            <input
              className="flex-1 bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-2xs font-medium"
              placeholder='Label (e.g. "Ebm draft — False Break")'
              value={alt.label}
              onChange={(e) =>
                onChange(alternates.map((a, j) => (j === i ? { ...a, label: e.target.value } : a)))
              }
            />
            <button
              className="text-2xs text-inkMuted hover:text-red-400 px-1"
              onClick={() => onChange(alternates.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
          <textarea
            className="w-full bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-3xs resize-y"
            placeholder="What was the idea?"
            value={alt.note}
            onChange={(e) => onChange(alternates.map((a, j) => (j === i ? { ...a, note: e.target.value } : a)))}
          />
        </div>
      ))}
      <button
        className="text-2xs border border-edge rounded px-1.5 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt"
        onClick={() => onChange([...alternates, { label: "", note: "" }])}
      >
        + Add alternate
      </button>
    </div>
  );
}

const STATUS_KEYS: (keyof ProductionStatus)[] = ["arrange", "tracking", "mix", "master"];

/** The dock's "Info" panel — replaces the old standalone Details tab.
 *  Same fields, same helper components as the old DetailsView, re-laid-out
 *  for a wide-short dock instead of a tall `max-w-2xl` column: frequently-
 *  touched fields (concept, notes, production status) sit in a single
 *  fixed row up front; the three list fields and Alternates (touched far
 *  less often) collapse into accordions, per the same "hide secondary
 *  controls" pattern already used for FormDisclosure/DensityPreview. */
export default function SongInfoPanel() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);

  if (!currentSong) return null;
  const song = currentSong;
  const status: ProductionStatus = song.status ?? { arrange: false, tracking: false, mix: false, master: false };

  return (
    <div className="p-2 space-y-2">
      {song.provenance && <ProvenanceBanner provenance={song.provenance} />}

      <div className="flex gap-2 flex-wrap items-start">
        <div className="flex-1 min-w-[160px]">
          <TextField
            label="Concept"
            value={song.concept ?? ""}
            onChange={(concept) => updateCurrentSong((s) => ({ ...s, concept }))}
            multiline
          />
        </div>
        <div className="w-32">
          <TextField
            label="Vocal delivery"
            value={song.notes?.vocalDelivery ?? ""}
            onChange={(v) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, vocalDelivery: v } }))}
          />
        </div>
        <div className="w-32">
          <TextField
            label="Dynamics"
            value={song.notes?.dynamics ?? ""}
            onChange={(v) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, dynamics: v } }))}
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <TextField
            label="Lyrical content"
            value={song.notes?.lyricalContent ?? ""}
            onChange={(v) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, lyricalContent: v } }))}
            multiline
          />
        </div>
        <div>
          <span className="block text-3xs text-inkMuted uppercase tracking-wide mb-0.5">Status</span>
          <div className="flex gap-2">
            {STATUS_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-1 text-2xs">
                <input
                  type="checkbox"
                  checked={status[key]}
                  onChange={(e) =>
                    updateCurrentSong((s) => ({ ...s, status: { ...status, [key]: e.target.checked } }))
                  }
                />
                {key}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <details className="border border-edge rounded px-2 py-1 w-56">
          <summary className="text-2xs cursor-pointer select-none text-inkMuted hover:text-ink">
            Instrumentation
          </summary>
          <div className="mt-1.5">
            <ListField
              label="Instrumentation"
              items={song.notes?.instrumentation ?? []}
              onChange={(instrumentation) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, instrumentation } }))}
              placeholder="No instrumentation notes yet."
            />
          </div>
        </details>
        <details className="border border-edge rounded px-2 py-1 w-56">
          <summary className="text-2xs cursor-pointer select-none text-inkMuted hover:text-ink">
            Additional ideas
          </summary>
          <div className="mt-1.5">
            <ListField
              label="Additional ideas"
              items={song.additionalIdeas ?? []}
              onChange={(additionalIdeas) => updateCurrentSong((s) => ({ ...s, additionalIdeas }))}
              placeholder="No additional ideas yet."
            />
          </div>
        </details>
        <details className="border border-edge rounded px-2 py-1 w-56">
          <summary className="text-2xs cursor-pointer select-none text-inkMuted hover:text-ink">References</summary>
          <div className="mt-1.5">
            <ListField
              label="References"
              items={song.references ?? []}
              onChange={(references) => updateCurrentSong((s) => ({ ...s, references }))}
              placeholder="No references yet."
            />
          </div>
        </details>
        <details className="border border-edge rounded px-2 py-1 w-64">
          <summary className="text-2xs cursor-pointer select-none text-inkMuted hover:text-ink">
            Alternate / abandoned drafts
          </summary>
          <div className="mt-1.5">
            <AlternatesEditor
              alternates={song.alternates ?? []}
              onChange={(alternates) => updateCurrentSong((s) => ({ ...s, alternates }))}
            />
          </div>
        </details>
      </div>
    </div>
  );
}
