#pragma once

#include <vector>

namespace td::layout
{
/** Every rectangle the editor draws or places, in one table.

    `paint()` and `resized()` both read this, and `TrackDraftTests` checks it, so
    a control cannot be moved without moving its label or failing the build. The
    table used to be a namespace of y coordinates plus a second, hand-copied set
    of x coordinates in `paint()`; the two drifted the first time a row was
    added.

    It is deliberately JUCE-free: the console tests include it, and they have no
    GUI. Sizes are in points, at the design's only resolution.
*/
struct Rect
{
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;

    constexpr int right() const noexcept { return x + width; }
    constexpr int bottom() const noexcept { return y + height; }

    constexpr bool intersects (const Rect& other) const noexcept
    {
        return x < other.right() && other.x < right() && y < other.bottom() && other.y < bottom();
    }
};

/** The content column: margin to margin, and nothing outside it. */
constexpr int margin = 16;
constexpr int width = 728;

/** The design height. A host with less room scrolls the canvas rather than
    clipping the bottom row, which is what a fixed 756-point editor did on a
    720-point screen. */
constexpr int height = 632;

/** Room for the vertical scrollbar, so the content keeps its width when it
    appears. Only the empty strip on the right is ever covered. */
constexpr int scrollbarAllowance = 14;
constexpr int editorWidth = width + 2 * margin + scrollbarAllowance;

/** No control is shorter than this: a 24-point row is the smallest that still
    holds a 13-point font and its inset. */
constexpr int controlHeight = 24;

constexpr int labelHeight = 14;

//==== The title block =====================================================
constexpr Rect title { margin, 6, 320, 22 };
constexpr Rect subtitle { margin, 29, 520, labelHeight };

//==== The song ============================================================
constexpr Rect sectionsLabel { margin, 48, 420, labelHeight };
constexpr Rect sectionBar { margin, 64, width, 28 };

constexpr Rect sectionName { margin, 96, 196, controlHeight };
constexpr Rect addSection { 218, 96, 30, controlHeight };
constexpr Rect duplicateSection { 254, 96, 52, controlHeight };
constexpr Rect deleteSection { 312, 96, 52, controlHeight };
constexpr Rect moveSectionLeft { 370, 96, 30, controlHeight };
constexpr Rect moveSectionRight { 406, 96, 30, controlHeight };
constexpr Rect ownKey { 442, 96, 88, controlHeight };
constexpr Rect sectionKey { 536, 96, 62, controlHeight };
constexpr Rect sectionScale { 604, 96, 140, controlHeight };

//==== Key, scale, and the selected slot ===================================
constexpr Rect keyLabel { margin, 126, 96, labelHeight };
constexpr Rect scaleLabel { 118, 126, 172, labelHeight };
constexpr Rect rootLabel { 296, 126, 72, labelHeight };
constexpr Rect qualityLabel { 374, 126, 158, labelHeight };
constexpr Rect beatsLabel { 644, 126, 100, labelHeight };

constexpr Rect key { margin, 142, 96, controlHeight };
constexpr Rect scale { 118, 142, 172, controlHeight };
constexpr Rect root { 296, 142, 72, controlHeight };
constexpr Rect quality { 374, 142, 158, controlHeight };
constexpr Rect seedFromKey { 538, 142, 100, controlHeight };
constexpr Rect beats { 644, 142, 100, controlHeight };

constexpr Rect strip { margin, 172, width, 64 };

//==== The slot's rhythm ===================================================
constexpr Rect rhythmLabel { margin, 242, 600, labelHeight };
constexpr Rect rhythmGrid { margin, 258, 512, controlHeight };
constexpr Rect rhythmSeed { 536, 258, 100, controlHeight };
constexpr Rect clearRhythm { 642, 258, 102, controlHeight };

//==== The walk, and what is heard =========================================
constexpr Rect walkLabel { margin, 288, 420, labelHeight };

constexpr int neighbourGap = 6;
constexpr int neighbourWidth = (width - 5 * neighbourGap) / 6;

constexpr Rect neighbourButton (int index)
{
    return { margin + index * (neighbourWidth + neighbourGap), 304, neighbourWidth,
             controlHeight };
}

constexpr Rect borrowed { margin, 334, 284, controlHeight };
constexpr Rect detectMidi { 306, 334, 110, controlHeight };
constexpr Rect useHeard { 422, 334, 100, controlHeight };

/** "Heard: …" and the message line — full width, because a failed import says
    more than a chord name does. */
constexpr Rect status { margin, 362, width, 16 };

//==== Articulation ========================================================
constexpr Rect articulationLabel { margin, 384, 96, labelHeight };
constexpr Rect amountLabel { 118, 384, 74, labelHeight };
constexpr Rect inversionLabel { 374, 384, 206, labelHeight };

constexpr Rect performance { margin, 400, 96, controlHeight };
constexpr Rect amount { 118, 400, 74, controlHeight };
constexpr Rect direction { 198, 400, 84, controlHeight };
constexpr Rect preview { 288, 400, 80, controlHeight };
constexpr Rect inversion { 374, 400, 118, controlHeight };
constexpr Rect spread { 498, 400, 84, controlHeight };
constexpr Rect applyFeel { 588, 400, 156, controlHeight };

//==== The host-facing voice ===============================================
constexpr Rect octaveLabel { margin, 430, 58, controlHeight };
constexpr Rect octave { 78, 430, 92, controlHeight };
constexpr Rect velocityLabel { 178, 430, 66, controlHeight };
constexpr Rect velocity { 248, 430, 92, controlHeight };
constexpr Rect gateLabel { 348, 430, 38, controlHeight };
constexpr Rect gate { 390, 430, 112, controlHeight };
constexpr Rect emitNotes { 508, 430, 236, controlHeight };

//==== Presets =============================================================
constexpr Rect presetsLabel { margin, 460, 120, labelHeight };
constexpr Rect presetBox { margin, 476, 190, controlHeight };
constexpr Rect presetName { 212, 476, 180, controlHeight };
constexpr Rect savePreset { 398, 476, 64, controlHeight };
constexpr Rect renamePreset { 468, 476, 76, controlHeight };
constexpr Rect deletePreset { 550, 476, 70, controlHeight };
constexpr Rect importPreset { 626, 476, 118, controlHeight };

//==== The arrangement =====================================================
constexpr Rect arrangementLabel { margin, 506, 120, labelHeight };
constexpr Rect arrangementLength { 416, 506, 328, labelHeight };
constexpr Rect arrangementBar { margin, 522, width, 28 };

constexpr Rect addPass { margin, 556, 80, controlHeight };
constexpr Rect moreRepeats { 102, 556, 80, controlHeight };
constexpr Rect fewerRepeats { 188, 556, 80, controlHeight };
constexpr Rect removePass { 274, 556, 80, controlHeight };
constexpr Rect saveSong { 624, 556, 120, controlHeight };

//==== The bass voice ======================================================
constexpr Rect bassLabel { margin, 586, 300, labelHeight };
constexpr Rect bassToggle { margin, 602, 96, controlHeight };
constexpr Rect bassOctave { 118, 602, 74, controlHeight };
constexpr Rect bassMotion { 198, 602, 112, controlHeight };
constexpr Rect bassRhythm { 316, 602, 104, controlHeight };
constexpr Rect bassVelocityLabel { 428, 602, 56, controlHeight };
constexpr Rect bassVelocity { 488, 602, 90, controlHeight };

/** Everything a click or a drag can land on — what the overlap check walks. */
inline std::vector<Rect> controlRects()
{
    std::vector<Rect> rects {
        sectionBar, sectionName, addSection, duplicateSection, deleteSection,
        moveSectionLeft, moveSectionRight, ownKey, sectionKey, sectionScale,
        key, scale, root, quality, seedFromKey, beats, strip,
        rhythmGrid, rhythmSeed, clearRhythm,
        borrowed, detectMidi, useHeard,
        performance, amount, direction, preview, inversion, spread, applyFeel,
        octave, velocity, gate, emitNotes,
        presetBox, presetName, savePreset, renamePreset, deletePreset, importPreset,
        arrangementBar, addPass, moreRepeats, fewerRepeats, removePass, saveSong,
        bassToggle, bassOctave, bassMotion, bassRhythm, bassVelocity };

    for (int i = 0; i < 6; ++i)
        rects.push_back (neighbourButton (i));

    return rects;
}

/** The drawn text, which is a rectangle too: a label that lands on a control is
    as wrong as two controls that land on each other. */
inline std::vector<Rect> labelRects()
{
    return { title, subtitle, sectionsLabel,
             keyLabel, scaleLabel, rootLabel, qualityLabel, beatsLabel,
             rhythmLabel, walkLabel,
             articulationLabel, amountLabel, inversionLabel,
             octaveLabel, velocityLabel, gateLabel,
             presetsLabel, arrangementLabel, arrangementLength,
             bassLabel, bassVelocityLabel };
}
} // namespace td::layout
