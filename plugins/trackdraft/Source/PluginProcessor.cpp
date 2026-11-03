#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>

namespace td
{
namespace
{
constexpr auto keyParam = "key";
constexpr auto scaleParam = "scale";
constexpr auto octaveParam = "octave";
constexpr auto velocityParam = "velocity";
constexpr auto gateParam = "gate";
constexpr auto enabledParam = "enabled";

juce::StringArray keyChoices()
{
    juce::StringArray names;
    for (int pc = 0; pc < 12; ++pc)
        names.add (theory::pitchClassName (pc));
    return names;
}

juce::StringArray scaleChoices()
{
    juce::StringArray names;
    for (int i = 0; i <= (int) theory::Scale::locrian; ++i)
        names.add (theory::displayNameOf ((theory::Scale) i));
    return names;
}
} // namespace

juce::AudioProcessorValueTreeState::ParameterLayout TrackDraftAudioProcessor::makeLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    params.push_back (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { keyParam, 1 }, "Key", keyChoices(), 0));
    params.push_back (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { scaleParam, 1 }, "Scale", scaleChoices(), 0));
    params.push_back (std::make_unique<juce::AudioParameterInt> (
        juce::ParameterID { octaveParam, 1 }, "Octave", 0, 8, 4));
    params.push_back (std::make_unique<juce::AudioParameterInt> (
        juce::ParameterID { velocityParam, 1 }, "Velocity", 1, 127, 100));
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { gateParam, 1 }, "Gate",
        juce::NormalisableRange<float> (0.05f, 1.0f, 0.01f), 0.9f));
    params.push_back (std::make_unique<juce::AudioParameterBool> (
        juce::ParameterID { enabledParam, 1 }, "Generate", true));

    return { params.begin(), params.end() };
}

TrackDraftAudioProcessor::TrackDraftAudioProcessor()
    : AudioProcessor (BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo(), false)
                                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "trackdraft", makeLayout())
{
    progression.seedFromScale (0, theory::Scale::ionian, 4);
}

TrackDraftAudioProcessor::~TrackDraftAudioProcessor() = default;

void TrackDraftAudioProcessor::prepareToPlay (double, int)
{
    juce::MidiBuffer flush;
    scheduler.reset (flush);
    heldNotes.fill (false);
    heardRoot.store (-1);
}

void TrackDraftAudioProcessor::releaseResources()
{
    juce::MidiBuffer flush;
    scheduler.reset (flush);
}

bool TrackDraftAudioProcessor::isBusesLayoutSupported (const BusesLayout&) const
{
    // A MIDI effect neither reads nor writes audio. Accepting the host's audio
    // layout and leaving it untouched is what keeps pass-through hosts happy.
    return true;
}

void TrackDraftAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer,
                                             juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;
    juce::ignoreUnused (buffer);  // a MIDI effect passes audio through untouched

    // Incoming notes keep flowing: this is an effect in the chain, not a
    // replacement for the track's instrument.
    juce::MidiBuffer generated;
    generated.addEvents (midiMessages, 0, -1, 0);

    updateDetection (midiMessages);

    TransportSlice transport;
    if (const auto* playHead = getPlayHead())
    {
        if (const auto position = playHead->getPosition())
        {
            transport.playing = position->getIsPlaying();
            if (const auto ppq = position->getPpqPosition())
            {
                const double blockPpq = buffer.getNumSamples() > 0
                                            ? (double) buffer.getNumSamples()
                                                  / (getSampleRate() * 60.0
                                                     / juce::jmax (1.0, (double) *position->getBpm()))
                                            : 0.0;
                transport.ppqStart = *ppq;
                transport.ppqEnd = *ppq + blockPpq;
            }
        }
    }

    VoiceSettings settings;
    settings.octave = (int) apvts.getRawParameterValue (octaveParam)->load();
    settings.velocity = (int) apvts.getRawParameterValue (velocityParam)->load();
    settings.gate = (double) apvts.getRawParameterValue (gateParam)->load();
    settings.enabled = apvts.getRawParameterValue (enabledParam)->load() > 0.5f;

    Progression current;
    {
        const juce::ScopedLock lock (progressionLock);
        current = progression;
    }

    scheduler.process (generated, transport, current, settings, buffer.getNumSamples());

    const int auditionRootPc = auditionRoot.exchange (-1);
    if (auditionRootPc >= 0)
    {
        auditionRootPc;  // consumed above; the value is read from the exchange
        ChordSlot preview;
        preview.rootPc = auditionRootPc;
        preview.quality = (theory::Quality) auditionQuality.load();
        preview.beats = 1.0;
        preview.performance = Performance::block;
        scheduler.audition (generated, preview, settings, buffer.getNumSamples(), getSampleRate());
    }

    if (transport.playing)
        playingSlot.store ((int) current.slotAtBeat (std::fmod (juce::jmax (0.0, transport.ppqStart),
                                                                juce::jmax (1e-6, current.lengthInBeats()))));
    else
        playingSlot.store (-1);

    midiMessages.swapWith (generated);
}

Progression TrackDraftAudioProcessor::getProgression() const
{
    const juce::ScopedLock lock (progressionLock);
    return progression;
}

void TrackDraftAudioProcessor::setProgression (const Progression& next)
{
    {
        const juce::ScopedLock lock (progressionLock);
        progression = next;
    }
    progressionBroadcaster.sendChangeMessage();
}

ChordSlot TrackDraftAudioProcessor::slotAtBeat (double beat) const
{
    const juce::ScopedLock lock (progressionLock);
    return progression.slots[progression.slotAtBeat (beat)];
}

void TrackDraftAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    Progression current;
    {
        const juce::ScopedLock lock (progressionLock);
        current = progression;
    }

    juce::XmlElement xml ("TrackDraftHarmony");
    xml.setAttribute ("version", 1);

    if (auto state = apvts.copyState().createXml())
        xml.addChildElement (state.release());

    auto* slots = xml.createNewChildElement ("progression");
    slots->setAttribute ("count", (int) current.count);
    for (std::size_t i = 0; i < current.count; ++i)
    {
        auto* slot = slots->createNewChildElement ("slot");
        slot->setAttribute ("root", current.slots[i].rootPc);
        slot->setAttribute ("quality", theory::idOf (current.slots[i].quality));
        slot->setAttribute ("beats", current.slots[i].beats);
        slot->setAttribute ("performance", (int) current.slots[i].performance);
        slot->setAttribute ("param", current.slots[i].param);
        slot->setAttribute ("direction", current.slots[i].direction);
    }

    copyXmlToBinary (xml, destData);
}

void TrackDraftAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr || ! xml->hasTagName ("TrackDraftHarmony"))
        return;

    if (auto* state = xml->getChildByName (apvts.state.getType()))
        apvts.replaceState (juce::ValueTree::fromXml (*state));

    Progression loaded;
    if (auto* slots = xml->getChildByName ("progression"))
    {
        const int count = juce::jlimit (1, (int) Progression::maxSlots, slots->getIntAttribute ("count", 4));
        loaded.count = (std::size_t) count;

        int index = 0;
        for (auto* slot : slots->getChildIterator())
        {
            if (index >= count)
                break;

            const auto qualityId = slot->getStringAttribute ("quality", "maj");
            theory::Quality quality = theory::Quality::maj;
            for (const auto& candidate : theory::qualities())
                if (qualityId == candidate.id)
                    quality = candidate.quality;

            ChordSlot loadedSlot;
            loadedSlot.rootPc = juce::jlimit (0, 11, slot->getIntAttribute ("root", 0));
            loadedSlot.quality = quality;
            loadedSlot.beats = juce::jmax (0.25, slot->getDoubleAttribute ("beats", 4.0));
            loadedSlot.performance = (Performance) juce::jlimit (
                0, 3, slot->getIntAttribute ("performance", 0));
            loadedSlot.param = juce::jlimit (0, 32, slot->getIntAttribute ("param", 0));
            loadedSlot.direction = juce::jlimit (0, 2, slot->getIntAttribute ("direction", 2));
            loaded.slots[(std::size_t) index] = loadedSlot;
            ++index;
        }
    }

    setProgression (loaded);
}

void TrackDraftAudioProcessor::setDetectionArmed (bool shouldListen)
{
    detectionArmed.store (shouldListen);

    if (! shouldListen)
    {
        heldNotes.fill (false);
        heardRoot.store (-1);
    }
}

void TrackDraftAudioProcessor::updateDetection (const juce::MidiBuffer& incoming)
{
    if (! detectionArmed.load())
    {
        heldNotes.fill (false);
        heardRoot.store (-1);
        return;
    }

    for (const auto metadata : incoming)
    {
        const auto message = metadata.getMessage();
        if (message.isNoteOn())
            heldNotes[(size_t) juce::jlimit (0, 127, message.getNoteNumber())] = true;
        else if (message.isNoteOff())
            heldNotes[(size_t) juce::jlimit (0, 127, message.getNoteNumber())] = false;
        else if (message.isAllNotesOff() || message.isAllSoundOff())
            heldNotes.fill (false);
    }

    // A pitch-class set is what the recogniser wants; the lowest note decides
    // the inversion, so the notes are collected in ascending order.
    std::vector<int> sounding;
    for (int note = 0; note < 128; ++note)
        if (heldNotes[(size_t) note])
            sounding.push_back (note);

    if (sounding.size() < 2)
    {
        heardRoot.store (-1);
        return;
    }

    RecognizeOptions options;
    options.permitted = theory::diatonicQualities (
        (theory::Scale) juce::jlimit (0, (int) theory::Scale::locrian,
                                      (int) apvts.getRawParameterValue (scaleParam)->load()));

    const int previousRoot = heardRoot.load();
    if (previousRoot >= 0)
    {
        options.hasPrevious = true;
        options.previousRootPc = previousRoot;
        options.previousQuality = (theory::Quality) heardQuality.load();
    }

    const auto recognized = recognizeChordFromNotes (sounding, options);
    if (recognized.valid)
    {
        heardRoot.store (recognized.rootPc);
        heardQuality.store ((int) recognized.quality);
    }
    else
    {
        heardRoot.store (-1);
    }
}

RecognizedChord TrackDraftAudioProcessor::getHeardChord() const
{
    const int root = heardRoot.load();
    RecognizedChord heard;
    if (root < 0)
        return heard;

    heard.valid = true;
    heard.rootPc = root;
    heard.quality = (theory::Quality) heardQuality.load();
    return heard;
}

bool TrackDraftAudioProcessor::writeHeardChordToSlot (std::size_t slot)
{
    const auto heard = getHeardChord();
    if (! heard.valid || slot >= Progression::maxSlots)
        return false;

    Progression next;
    {
        const juce::ScopedLock lock (progressionLock);
        next = progression;
    }

    if (slot >= next.count)
        next.count = slot + 1;

    const double beats = next.slots[slot].beats;
    next.slots[slot] = { heard.rootPc, heard.quality, beats > 0.0 ? beats : 4.0 };
    setProgression (next);
    return true;
}

void TrackDraftAudioProcessor::auditionSlot (std::size_t slot)
{
    Progression current;
    {
        const juce::ScopedLock lock (progressionLock);
        current = progression;
    }

    if (slot >= current.count)
        return;

    auditionChord (current.slots[slot].rootPc, current.slots[slot].quality);
}

void TrackDraftAudioProcessor::auditionChord (int rootPc, theory::Quality quality)
{
    auditionQuality.store ((int) quality);
    auditionRoot.store (rootPc);
}

juce::AudioProcessorEditor* TrackDraftAudioProcessor::createEditor()
{
    return new TrackDraftAudioProcessorEditor (*this);
}
} // namespace td

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new td::TrackDraftAudioProcessor();
}
