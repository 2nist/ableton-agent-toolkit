import { countBlockSyllables } from "../../lib/lyrics/syllables";

interface LyricsEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function LyricsEditor({ value, onChange }: LyricsEditorProps) {
  const lines = countBlockSyllables(value);

  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      {/* wrap="off" keeps one physical line == one visual row, so the
          syllable-count gutter on the right stays aligned per-line. */}
      <textarea
        wrap="off"
        className="bg-panelAlt border border-edge rounded px-3 py-2 text-sm leading-6 resize-y min-h-[160px] overflow-x-auto whitespace-pre"
        placeholder="Lyrics for this section…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(6, lines.length)}
      />
      <div className="text-xs text-inkMuted leading-6 pt-2 text-right select-none">
        {lines.map((l, i) => (
          <div key={i}>{l.line.trim() ? l.syllables : " "}</div>
        ))}
      </div>
    </div>
  );
}
