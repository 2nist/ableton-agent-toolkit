#include "ChordScheduler.h"

#include <algorithm>
#include <cmath>

namespace td
{
namespace
{
/** Sample offset for a ppq position inside this block, clamped to the block. */
int offsetForPpq (double ppq, double ppqStart, double ppqEnd, int numSamples)
{
    const double span = ppqEnd - ppqStart;
    if (span <= 0.0 || numSamples <= 0)
        return 0;

    const double fraction = (ppq - ppqStart) / span;
    const int sample = (int) std::llround (fraction * (double) numSamples);
    return juce::jlimit (0, juce::jmax (0, numSamples - 1), sample);
}

int rootMidiFor (const ChordSlot& slot, const VoiceSettings& settings)
{
    // Octave 4 is the octave that starts at middle C (MIDI 60), which is the
    // numbering every DAW and the app's BassProfile already use.
    return juce::jlimit (0, 127, (settings.octave + 1) * 12 + slot.rootPc);
}
} // namespace

void ChordScheduler::reset (juce::MidiBuffer& out, int sampleOffsetToUse)
{
    stopGenerated (out, sampleOffsetToUse);
    stopAudition (out, sampleOffsetToUse);
    wasPlaying = false;
    lastPpq = 0.0;
}

void ChordScheduler::stopGenerated (juce::MidiBuffer& out, int samplePosition)
{
    for (const auto& voice : voices)
        out.addEvent (juce::MidiMessage::noteOff (voice.channel, voice.note), samplePosition);

    voices.clear();
    pending.clear();
}

void ChordScheduler::stopAudition (juce::MidiBuffer& out, int samplePosition)
{
    for (const auto& note : auditionVoices)
        out.addEvent (juce::MidiMessage::noteOff (note.first, note.second), samplePosition);

    auditionVoices.clear();
    auditionSamplesLeft = 0;
}

void ChordScheduler::scheduleChord (double atPpq, const ChordSlot& slot,
                                    const VoiceSettings& settings)
{
    const int rootMidi = rootMidiFor (slot, settings);
    const int velocity = juce::jlimit (1, 127, settings.velocity);
    const auto events = shapeChord (rootMidi, slot.quality, slot.beats, velocity,
                                    slot.articulation (settings.gate));

    for (const auto& event : events)
        pending.push_back ({ atPpq + event.offsetBeats, event.note, event.velocity,
                             event.durationBeats });
}

void ChordScheduler::emitPending (juce::MidiBuffer& out, double upToPpqInclusive,
                                  double ppqStart, double ppqEnd, int numSamples)
{
    for (auto it = pending.begin(); it != pending.end();)
    {
        if (it->ppq > upToPpqInclusive)
        {
            ++it;
            continue;
        }

        const int sample = offsetForPpq (it->ppq, ppqStart, ppqEnd, numSamples);
        out.addEvent (juce::MidiMessage::noteOn (1, it->note, (juce::uint8) it->velocity), sample);
        voices.push_back ({ it->note, 1, it->ppq + std::max (0.02, it->durationBeats) });
        it = pending.erase (it);
    }
}

void ChordScheduler::retireVoices (juce::MidiBuffer& out, double upToPpqInclusive,
                                   double ppqStart, double ppqEnd, int numSamples)
{
    for (auto it = voices.begin(); it != voices.end();)
    {
        if (it->endPpq <= upToPpqInclusive)
        {
            const int sample = offsetForPpq (it->endPpq, ppqStart, ppqEnd, numSamples);
            out.addEvent (juce::MidiMessage::noteOff (it->channel, it->note), sample);
            it = voices.erase (it);
        }
        else
        {
            ++it;
        }
    }
}

void ChordScheduler::process (juce::MidiBuffer& out,
                              const TransportSlice& transport,
                              const Progression& progression,
                              const VoiceSettings& settings,
                              int numSamples)
{
    // An audition outlives the transport state: count it down in samples and
    // release it when it expires, whether or not the host is playing.
    if (auditionSamplesLeft > 0)
    {
        auditionSamplesLeft -= numSamples;
        if (auditionSamplesLeft <= 0)
        {
            for (const auto& note : auditionVoices)
                out.addEvent (juce::MidiMessage::noteOff (note.first, note.second), 0);
            auditionVoices.clear();
        }
    }

    const double loopLength = progression.lengthInBeats();

    // A stopped, rewound or disabled transport must not leave notes ringing.
    if (! transport.playing || ! settings.enabled || loopLength <= 0.0)
    {
        if (! voices.empty() || ! pending.empty() || wasPlaying)
            stopGenerated (out, 0);
        wasPlaying = false;
        lastPpq = transport.ppqEnd;
        return;
    }

    // A jump backwards (host loop, relocated playhead) starts a fresh cycle.
    if (transport.ppqStart < lastPpq - 1e-9)
        stopGenerated (out, 0);

    // Blocks tile the timeline half-open — [ppqStart, ppqEnd) — so a boundary
    // that lands exactly on a block edge is emitted once, at offset 0 of the
    // block it opens, instead of being lost between two blocks.
    struct Boundary
    {
        double ppq;
        std::size_t slot;
    };
    std::vector<Boundary> boundaries;

    const double firstCycle = std::floor (transport.ppqStart / loopLength) * loopLength;
    for (double cycleStart = firstCycle; cycleStart <= transport.ppqEnd; cycleStart += loopLength)
        for (std::size_t slot = 0; slot < progression.count; ++slot)
        {
            const double boundary = cycleStart + progression.startBeatOf (slot);
            if (boundary >= transport.ppqStart && boundary < transport.ppqEnd)
                boundaries.push_back ({ boundary, slot });
        }

    std::stable_sort (boundaries.begin(), boundaries.end(),
                      [] (const Boundary& a, const Boundary& b) { return a.ppq < b.ppq; });

    // Walk the block in ppq order: retire what has finished, start a new chord
    // at its boundary (cancelling the previous chord's unplayed articulation),
    // and emit anything that is due.
    double cursor = transport.ppqStart;
    for (const auto& boundary : boundaries)
    {
        retireVoices (out, boundary.ppq, transport.ppqStart, transport.ppqEnd, numSamples);
        emitPending (out, boundary.ppq, transport.ppqStart, transport.ppqEnd, numSamples);

        // Notes still ringing at the boundary are the previous chord: release
        // them and drop its remaining pattern.
        for (const auto& voice : voices)
            out.addEvent (juce::MidiMessage::noteOff (voice.channel, voice.note),
                          offsetForPpq (boundary.ppq, transport.ppqStart, transport.ppqEnd,
                                        numSamples));
        voices.clear();
        pending.clear();

        scheduleChord (boundary.ppq, progression.slots[boundary.slot], settings);
        emitPending (out, boundary.ppq, transport.ppqStart, transport.ppqEnd, numSamples);
        cursor = boundary.ppq;
    }
    juce::ignoreUnused (cursor);

    retireVoices (out, transport.ppqEnd, transport.ppqStart, transport.ppqEnd, numSamples);
    emitPending (out, transport.ppqEnd, transport.ppqStart, transport.ppqEnd, numSamples);

    wasPlaying = true;
    lastPpq = transport.ppqEnd;
}

void ChordScheduler::audition (juce::MidiBuffer& out,
                               const ChordSlot& slot,
                               const VoiceSettings& settings,
                               int numSamples,
                               double sampleRate)
{
    // Stop anything already sounding from a previous audition.
    stopAudition (out, 0);

    const int rootMidi = rootMidiFor (slot, settings);
    const int velocity = juce::jlimit (1, 127, settings.velocity);

    for (int interval : theory::intervalsOf (slot.quality))
    {
        const int note = rootMidi + interval;
        if (note < 0 || note > 127)
            continue;

        out.addEvent (juce::MidiMessage::noteOn (1, note, (juce::uint8) velocity), 0);
        auditionVoices.emplace_back (1, note);
    }

    // 0.6 s is long enough to hear the voicing and short enough never to
    // collide with the next click.
    auditionSamplesLeft = juce::jmax (numSamples, (int) std::lround (sampleRate * 0.6));
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
