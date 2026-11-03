#include "ChordWalk.h"

namespace td
{
namespace
{
// DIRS from honeycombWalk.ts, one cell each:
//   ( 1,  0) ( -1,  0) ( 0,  1) ( 0, -1) ( 1, -1) ( -1,  1)
// With degree(q, r) = (3q + r) mod 7 these become d+3, d+4, d+1, d+6, d+2, d+5.
constexpr int degreeOffsets[6] = { 3, 4, 1, 6, 2, 5 };
} // namespace

std::array<WalkNeighbour, 6> neighboursOf (theory::Scale scale, int degree)
{
    std::array<WalkNeighbour, 6> neighbours {};

    for (int i = 0; i < 6; ++i)
    {
        const int neighbourDegree = ((degree + degreeOffsets[i]) % 7 + 7) % 7;
        const auto chord = theory::diatonicChordAt (scale, neighbourDegree);
        neighbours[(size_t) i] = { neighbourDegree,
                                   chord.rootOffset,
                                   chord.quality,
                                   theory::romanNumeral (neighbourDegree, chord.quality) };
    }

    return neighbours;
}

WalkNeighbour nextAlongWalk (theory::Scale scale, int degree)
{
    // Clockwise on the grid is the first DIRS entry, which lands on d+3 — the
    // subdominant-to-tonic side of the cycle, the move a walk usually makes
    // next. Wrapping keeps a walk going forever.
    const int nextDegree = ((degree + degreeOffsets[0]) % 7 + 7) % 7;
    const auto chord = theory::diatonicChordAt (scale, nextDegree);
    return { nextDegree, chord.rootOffset, chord.quality,
             theory::romanNumeral (nextDegree, chord.quality) };
}
} // namespace td
