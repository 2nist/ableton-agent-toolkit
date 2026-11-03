#include "ChordScheduler.h"

#include <algorithm>
#include <cmath>

namespace td
{
namespace
{
/** Sample offset for a ppq position inside this block, clamped to the block. */
int offsetForPpq (double ppq, const TransportSlice& transport, int numSamples)
{
    const double span = transport.ppqEnd - transport.ppqStart;
    if (span <= 0.0 || numSamples <= 0)
        return 0;

    const double fraction = (ppq - transport.ppqStart) / span;
    const int sample = (int) std::llround (fraction * (double) numSamples);
    return juce::jlimit (0, juce::jmax (0, numSamples - 1), sample);
}
} // namespace

void ChordScheduler::reset (juce::MidiBuffer& out, int sampleOffsetToUse)
{
    stopAll (out, sampleOffsetToUse);
    wasPlaying = false;
    lastPpq = 0.0;
}

void ChordScheduler::stopAll (juce::MidiBuffer& out, int samplePosition)
{
    for (const auto& voice : voices)
        out.addEvent (juce::MidiMessage::noteOff (voice.channel, voice.note), samplePosition);

    voices.clear();
}

void ChordScheduler::startChord (juce::MidiBuffer& out, int samplePosition, int rootMidi,
                                 theory::Quality quality, int velocity, double endPpq)
{
    // Intervals above the octave are kept: a 9th is a 9th, not a second.
    for (int interval : theory::intervalsOf (quality))
    {
        const int note = rootMidi + interval;
        if (note < 0 || note > 127)
            continue;

        out.addEvent (juce::MidiMessage::noteOn (1, note, (juce::uint8) velocity), samplePosition);
        voices.push_back ({ note, 1, endPpq });
    }
}

void ChordScheduler::process (juce::MidiBuffer& out,
                              const TransportSlice& transport,
                              const Progression& progression,
                              const VoiceSettings& settings,
                              int numSamples)
{
    const double loopLength = progression.lengthInBeats();

    // A stopped, rewound or disabled transport must not leave notes ringing.
    if (! transport.playing || ! settings.enabled || loopLength <= 0.0)
    {
        if (! voices.empty() || wasPlaying)
            stopAll (out, 0);

        wasPlaying = false;
        lastPpq = transport.ppqEnd;
        return;
    }

    // A jump backwards (host loop, relocated playhead) starts a fresh cycle.
    if (transport.ppqStart < lastPpq - 1e-9)
        stopAll (out, 0);

    struct Event
    {
        double ppq;
        int sample;
        bool isOn;
        std::size_t slot;
    };
    std::vector<Event> events;

    // Blocks tile the timeline half-open — [ppqStart, ppqEnd) — so a boundary
    // that lands exactly on a block edge is emitted once, at offset 0 of the
    // block it opens, instead of being lost between two blocks.
    //
    // Gate ends first, so a note-off that collides with a boundary is written
    // before the new chord's note-on.
    for (const auto& voice : voices)
        if (voice.endPpq >= transport.ppqStart && voice.endPpq < transport.ppqEnd)
            events.push_back ({ voice.endPpq, offsetForPpq (voice.endPpq, transport, numSamples),
                                false, 0 });

    // Every chord boundary inside this block. Slot boundaries repeat with the
    // loop, so a block can contain the start of the next cycle.
    const double firstBoundaryIndex = std::floor (transport.ppqStart / loopLength) * loopLength;
    for (double cycleStart = firstBoundaryIndex;
         cycleStart <= transport.ppqEnd + loopLength;
         cycleStart += loopLength)
    {
        for (std::size_t slot = 0; slot < progression.count; ++slot)
        {
            const double boundary = cycleStart + progression.startBeatOf (slot);
            if (boundary >= transport.ppqStart && boundary < transport.ppqEnd)
                events.push_back ({ boundary, offsetForPpq (boundary, transport, numSamples), true, slot });
        }
    }

    std::stable_sort (events.begin(), events.end(), [] (const Event& a, const Event& b)
    {
        if (a.ppq < b.ppq || a.ppq > b.ppq)
            return a.ppq < b.ppq;
        return (int) a.isOn < (int) b.isOn;  // offs before ons at the same ppq
    });

    for (const auto& event : events)
    {
        if (! event.isOn)
        {
            // Retire the voices whose gate has ended at this position.
            for (auto it = voices.begin(); it != voices.end();)
            {
                if (it->endPpq <= event.ppq)
                {
                    out.addEvent (juce::MidiMessage::noteOff (it->channel, it->note), event.sample);
                    it = voices.erase (it);
                }
                else
                {
                    ++it;
                }
            }
            continue;
        }

        const auto& slot = progression.slots[event.slot];
        const double slotBeats = std::max (0.0, slot.beats);
        const double gateBeats = juce::jlimit (0.05, 1.0, settings.gate) * slotBeats;
        const double endPpq = event.ppq + std::max (0.05, gateBeats);

        stopAll (out, event.sample);

        // Octave 4 is the octave that starts at middle C (MIDI 60), which is
        // the numbering every DAW and the app's BassProfile already use.
        const int rootMidi = juce::jlimit (0, 127, (settings.octave + 1) * 12 + slot.rootPc);
        const int velocity = juce::jlimit (1, 127, settings.velocity);
        startChord (out, event.sample, rootMidi, slot.quality, velocity, endPpq);
    }

    wasPlaying = true;
    lastPpq = transport.ppqEnd;
}

std::vector<int> ChordScheduler::activeNotes() const
{
    std::vector<int> notes;
    notes.reserve (voices.size());
    for (const auto& voice : voices)
        notes.push_back (voice.note);
    return notes;
}
} // namespace td
