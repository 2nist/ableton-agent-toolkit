#pragma once

#include "Progression.h"

#include <vector>

namespace td
{
/**
    Onset steps of a Euclidean rhythm — a port of the app's `euclidOnsetSteps`
    (`packages/drum-library/src/section.ts`), the rule the drum engine uses to
    spread `k` hits over `n` steps:

        step_i = round(i * n / k), rotated, sorted

    That is the *rounding* form, not Bjorklund's, so `k=3, n=8` gives
    {0, 3, 5} where Bjorklund gives {0, 3, 6}. Ported as it is rather than
    "corrected": the point of seeding a chord grid from the drum engine is that
    the two agree, not that each is defensible on its own.
*/
std::vector<int> euclidSteps (int k, int n, int rotation);

/** A named rhythm the grid can be seeded from. */
struct RhythmSeed
{
    const char* name;
    /** Hits and steps of the Euclidean loop. */
    int k;
    int n;
    int rotation;
};

/** The seeds offered in the editor, shortest cycle first. */
const std::vector<RhythmSeed>& rhythmSeeds();

/**
    Fills a grid from `k` of `n` over one bar: the loop is mapped onto the bar
    proportionally, so an eight-step seed lands on the eighths and a
    sixteen-step one on the sixteenths.

    The bar is `target`'s own length — a bar of 3/4 is twelve sixteenths — so a
    seeded groove agrees with the section's meter rather than the plug-in's
    assumption. The length is read from `target` and then rewritten, which is how
    a grid drawn against a 3/4 bar keeps its twelve steps.

    Hits are normal; the downbeat and the middle of the bar are accented when the
    loop hits them, which is the one piece of taste involved and is spelled out
    here rather than hidden in the UI.
*/
void seedPattern (RhythmPattern& target, int k, int n, int rotation);
} // namespace td
