#include "Performance.h"

#include <algorithm>
#include <cmath>

namespace td
{
namespace
{
/** Triangle wave 0..1..0 across `count` hits, for pulse accents. */
double triangle (int index, int count)
{
    if (count <= 1)
        return 1.0;

    const double phase = (double) index / (double) (count - 1);
    return 1.0 - std::abs (phase * 2.0 - 1.0);
}
} // namespace

std::vector<PerformanceEvent> shapeChord (int rootMidi,
                                          theory::Quality quality,
                                          double slotBeats,
                                          int velocity,
                                          const PerformanceSettings& settings,
                                          const theory::Voicing& voicing)
{
    const double beats = std::max (0.25, slotBeats);
    const int gateVelocity = std::clamp (velocity, 1, 127);
    std::vector<PerformanceEvent> events;

    // The voicing decides the notes: which tone is in the bass (so an inversion
    // is audible on its own) and whether the spread is close or open. Chord
    // tones above the octave keep their colour — a 9th stays a 9th.
    const auto shaped = theory::voicedNotes (rootMidi, quality, voicing);
    if (shaped.empty())
        return events;

    auto notes = shaped;

    switch (settings.kind)
    {
        case Performance::block:
        {
            const double duration = beats * std::clamp (settings.gate, 0.05, 1.0);
            for (int note : notes)
                events.push_back ({ 0.0, note, gateVelocity, duration });
            return events;
        }

        case Performance::strum:
        {
            // performance.ts: staggerBeats = strumMs / 1000 * 2, split across
            // the gaps between notes so the last one lands on the stagger.
            const int strumMs = settings.param > 0 ? settings.param : 150;
            const double staggerBeats = (double) strumMs / 1000.0 * 2.0;
            const double interval = staggerBeats / (double) std::max<size_t> (1, notes.size() - 1);
            const double full = beats * std::clamp (settings.gate, 0.05, 1.0);

            for (size_t i = 0; i < notes.size(); ++i)
            {
                const double offset = (double) i * interval;
                events.push_back ({ offset, notes[i], gateVelocity,
                                    std::max (0.05, full - offset) });
            }
            return events;
        }

        case Performance::pulse:
        {
            const int hits = std::clamp (settings.param > 0 ? settings.param : 4, 1, 16);
            const double step = beats / (double) hits;
            const double sounding = std::max (0.05, step * 0.5);

            for (int hit = 0; hit < hits; ++hit)
            {
                // A triangle across the slot, so a pulse breathes instead of
                // machine-gunning at one velocity.
                const int hitVelocity = std::clamp (
                    (int) std::lround ((double) gateVelocity
                                       * (0.6 + 0.4 * triangle (hit, hits))),
                    1, 127);

                for (int note : notes)
                    events.push_back ({ (double) hit * step, note, hitVelocity, sounding });
            }
            return events;
        }

        case Performance::arp:
        {
            const int steps = std::clamp (settings.param > 0 ? settings.param : 4, 1, 32);
            const double step = beats / (double) steps;
            const double sounding = std::max (0.05, step * 0.9);

            // up / down / up-down, exactly the app's three musical directions.
            std::vector<int> sequence;
            if (settings.direction == 1)
            {
                sequence.assign (notes.rbegin(), notes.rend());
            }
            else if (settings.direction == 2)
            {
                sequence = notes;
                // Skip the turnaround duplicates so the top note is not played
                // twice in a row when the cycle reverses.
                for (size_t i = notes.size(); i-- > 1;)
                    sequence.push_back (notes[i - 1]);
                if (sequence.size() > 1 && sequence.front() == sequence.back() && notes.size() > 2)
                    sequence.pop_back();
            }
            else
            {
                sequence = notes;
            }

            for (int step_ = 0; step_ < steps; ++step_)
                events.push_back ({ (double) step_ * step,
                                    sequence[(size_t) step_ % sequence.size()],
                                    gateVelocity,
                                    sounding });
            return events;
        }
    }

    return events;
}
} // namespace td
