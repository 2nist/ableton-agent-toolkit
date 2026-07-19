import { useSongStore } from "../../store/songStore";
import type { AlternateDraft, ProductionStatus, Provenance } from "../../types/blueprint";

const SOURCE_LABEL: Record<Provenance["source"], string> = {
  manual: "Manual entry",
  "docx-ingest": "Ingested from docx/xlsx source material",
  "audio-extract": "Extracted from audio",
  "midi-import": "Imported from MIDI",
};

function ProvenanceBanner({ provenance }: { provenance: Provenance }) {
  if (provenance.source === "manual") return null;
  return (
    <div className="border border-amber-700/40 bg-amber-950/20 rounded p-3 space-y-1.5">
      <p className="text-xs font-medium text-amber-400">
        {SOURCE_LABEL[provenance.source]} — draft, review before finalizing
      </p>
      {provenance.warnings && provenance.warnings.length > 0 && (
        <ul className="text-[11px] text-amber-200/80 list-disc list-inside space-y-0.5">
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
    <label className="block space-y-1">
      <span className="text-xs text-inkMuted uppercase tracking-wide">{label}</span>
      {multiline ? (
        <textarea
          className="w-full bg-panelAlt border border-edge rounded px-2 py-1.5 text-sm resize-y min-h-[70px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="w-full bg-panelAlt border border-edge rounded px-2 py-1.5 text-sm"
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
      <span className="text-xs text-inkMuted uppercase tracking-wide">{label}</span>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1">
            <input
              className="flex-1 bg-panelAlt border border-edge rounded px-2 py-1 text-sm"
              value={item}
              onChange={(e) => onChange(items.map((it, j) => (j === i ? e.target.value : it)))}
            />
            <button
              className="text-xs text-inkMuted hover:text-red-400 px-2"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="text-xs border border-edge rounded px-2 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
          onClick={() => onChange([...items, ""])}
        >
          + Add
        </button>
      </div>
      {items.length === 0 && <p className="text-xs text-inkMuted">{placeholder}</p>}
    </div>
  );
}

const STATUS_KEYS: (keyof ProductionStatus)[] = ["arrange", "tracking", "mix", "master"];

export default function DetailsView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);

  if (!currentSong) return null;
  const song = currentSong;
  const status: ProductionStatus = song.status ?? { arrange: false, tracking: false, mix: false, master: false };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {song.provenance && <ProvenanceBanner provenance={song.provenance} />}

      <TextField
        label="Concept"
        value={song.concept ?? ""}
        onChange={(concept) => updateCurrentSong((s) => ({ ...s, concept }))}
        multiline
      />

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Vocal delivery"
          value={song.notes?.vocalDelivery ?? ""}
          onChange={(v) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, vocalDelivery: v } }))}
        />
        <TextField
          label="Dynamics"
          value={song.notes?.dynamics ?? ""}
          onChange={(v) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, dynamics: v } }))}
        />
      </div>
      <TextField
        label="Lyrical content"
        value={song.notes?.lyricalContent ?? ""}
        onChange={(v) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, lyricalContent: v } }))}
        multiline
      />

      <ListField
        label="Instrumentation"
        items={song.notes?.instrumentation ?? []}
        onChange={(instrumentation) => updateCurrentSong((s) => ({ ...s, notes: { ...s.notes, instrumentation } }))}
        placeholder="No instrumentation notes yet."
      />
      <ListField
        label="Additional ideas"
        items={song.additionalIdeas ?? []}
        onChange={(additionalIdeas) => updateCurrentSong((s) => ({ ...s, additionalIdeas }))}
        placeholder="No additional ideas yet."
      />
      <ListField
        label="References"
        items={song.references ?? []}
        onChange={(references) => updateCurrentSong((s) => ({ ...s, references }))}
        placeholder="No references yet."
      />

      <div className="space-y-1">
        <span className="text-xs text-inkMuted uppercase tracking-wide">Production status</span>
        <div className="flex gap-4">
          {STATUS_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1.5 text-sm">
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

      <div className="space-y-1">
        <span className="text-xs text-inkMuted uppercase tracking-wide">Alternate / abandoned drafts</span>
        <p className="text-[11px] text-inkMuted">
          A place to preserve ideas that didn't make the final version — e.g. an earlier key, a cut section, a
          different ending — rather than losing them when the song changes.
        </p>
        <AlternatesEditor
          alternates={song.alternates ?? []}
          onChange={(alternates) => updateCurrentSong((s) => ({ ...s, alternates }))}
        />
      </div>
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
    <div className="space-y-2">
      {alternates.map((alt, i) => (
        <div key={i} className="border border-edge rounded p-2 space-y-1">
          <div className="flex gap-1">
            <input
              className="flex-1 bg-panelAlt border border-edge rounded px-2 py-1 text-sm font-medium"
              placeholder='Label (e.g. "Ebm draft — False Break")'
              value={alt.label}
              onChange={(e) =>
                onChange(alternates.map((a, j) => (j === i ? { ...a, label: e.target.value } : a)))
              }
            />
            <button
              className="text-xs text-inkMuted hover:text-red-400 px-2"
              onClick={() => onChange(alternates.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
          <textarea
            className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-xs resize-y"
            placeholder="What was the idea?"
            value={alt.note}
            onChange={(e) => onChange(alternates.map((a, j) => (j === i ? { ...a, note: e.target.value } : a)))}
          />
        </div>
      ))}
      <button
        className="text-xs border border-edge rounded px-2 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
        onClick={() => onChange([...alternates, { label: "", note: "" }])}
      >
        + Add alternate
      </button>
    </div>
  );
}
