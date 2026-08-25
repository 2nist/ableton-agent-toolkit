import { resolveOutlineVoiceNecklaces } from "../../lib/playback/drumPreview";
import { VOICE_COLOR, VOICE_LABEL } from "./voiceStyle";
import { outlineBeatsPerBar } from "@drum/library";
import type { MeterOutline } from "../../types/blueprint";

const LEFT_MARGIN = 34;
const PX_PER_BEAT = 46;
const ROW_H = 26;
const RULER_H = 22;

/** The "end result" view that was missing entirely: a real, beat-numbered
 *  linear timeline for one bar of the outline being edited — not a ring
 *  diagram, an actual left-to-right readout of what plays and exactly
 *  when. The top row is Ferguson's own counting text ("1 2 1 2 1 2 3"),
 *  positioned at each subdivision's real beat so the mnemonic and the
 *  timeline are the same thing, not two disconnected representations;
 *  cell boundaries get a heavier gridline so the 2s/3s grouping still
 *  reads at a glance. Below that, one row per voice actually present,
 *  with a tick at every real hit and its exact beat number underneath. */
export default function OutlineTimeline({ outline }: { outline: MeterOutline }) {
  const bpb = outlineBeatsPerBar(outline);
  const necklaces = resolveOutlineVoiceNecklaces(outline);
  const countTokens = outline.label.split(" ");

  // Cell-boundary beats and which count-token starts each cell — used to
  // place both the heavier gridlines and the counting text.
  const tokensBySubdivision: { beat: number; token: string; isCellStart: boolean }[] = [];
  let beat = 0;
  let tokenIdx = 0;
  for (const cell of outline.cells) {
    for (let sub = 0; sub < cell; sub++) {
      tokensBySubdivision.push({ beat, token: countTokens[tokenIdx] ?? "", isCellStart: sub === 0 });
      beat += outline.cellBeats;
      tokenIdx++;
    }
  }

  const beatToX = (b: number) => LEFT_MARGIN + b * PX_PER_BEAT;
  const width = beatToX(bpb) + 16;

  const voices = (necklaces ?? []).filter((n) => n.count > 0);
  const bodyHeight = Math.max(1, voices.length) * ROW_H;

  return (
    <div className="overflow-x-auto border border-edge rounded bg-panelAlt">
      <svg width={width} height={RULER_H + bodyHeight + 6} className="block">
        {/* subdivision gridlines + Ferguson counting text */}
        {tokensBySubdivision.map((t, i) => (
          <line
            key={`grid-${i}`}
            x1={beatToX(t.beat)} y1={RULER_H} x2={beatToX(t.beat)} y2={RULER_H + bodyHeight}
            stroke={t.isCellStart ? "#3A3F4B" : "#23293A"}
            strokeWidth={t.isCellStart ? 1.4 : 1}
          />
        ))}
        {tokensBySubdivision.map((t, i) => (
          <text
            key={`count-${i}`}
            x={beatToX(t.beat)} y={13}
            textAnchor="middle"
            fontFamily="monospace"
            fontSize={t.isCellStart ? 11 : 9}
            fontWeight={t.isCellStart ? 700 : 400}
            fill={t.isCellStart ? "#F5E7C8" : "#8B94A1"}
          >
            {t.token}
          </text>
        ))}

        {voices.length === 0 ? (
          <text x={LEFT_MARGIN} y={RULER_H + ROW_H / 2 + 3} fontFamily="monospace" fontSize={9} fill="#565F70">
            no voices assigned yet
          </text>
        ) : (
          voices.map((v, vi) => {
            const y = RULER_H + vi * ROW_H + ROW_H / 2;
            const color = VOICE_COLOR[v.voice] ?? "#8B94A1";
            return (
              <g key={v.voice}>
                <text x={2} y={y + 3} fontFamily="monospace" fontSize={8} fill={color}>{VOICE_LABEL[v.voice]}</text>
                <line x1={beatToX(0)} y1={y} x2={beatToX(bpb)} y2={y} stroke="#23293A" strokeWidth={1} />
                {v.hits.map((frac, hi) => {
                  const hitBeat = Math.round(frac * bpb * 1000) / 1000;
                  const x = beatToX(hitBeat);
                  return (
                    <g key={hi}>
                      <line x1={x} y1={y - 6} x2={x} y2={y + 6} stroke={color} strokeWidth={2} />
                      <text x={x} y={y + ROW_H / 2 - 3} textAnchor="middle" fontFamily="monospace" fontSize={7} fill={color} opacity={0.85}>
                        {hitBeat}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}
