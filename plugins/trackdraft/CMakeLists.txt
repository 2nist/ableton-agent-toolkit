cmake_minimum_required(VERSION 3.22)

project(TrackDraftHarmony VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")

# JUCE is pinned by tag; FetchContent keeps the checkout out of the repository
# (it is ~100 MB of sources that no other workspace here needs).
include(FetchContent)

set(JUCE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(JUCE_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)
set(JUCE_ENABLE_MODULE_SOURCE_GROUPS OFF CACHE BOOL "" FORCE)

if (NOT DEFINED JUCE_PATH)
    FetchContent_Declare(
        JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG        8.0.15
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(JUCE)
else()
    add_subdirectory("${JUCE_PATH}" JUCE)
endif()

juce_add_plugin(TrackDraftHarmony
    PRODUCT_NAME                "TrackDraft Harmony"
    COMPANY_NAME                "TrackDraft"
    BUNDLE_ID                   "com.trackdraft.harmony"
    PLUGIN_MANUFACTURER_CODE    Tdft
    PLUGIN_CODE                 Tdh1
    FORMATS                     VST3 AU Standalone
    IS_MIDI_EFFECT              TRUE
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_MIDI_OUTPUT           TRUE
    IS_SYNTH                    FALSE
    COPY_PLUGIN_AFTER_BUILD     FALSE
)

target_sources(TrackDraftHarmony PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/Progression.cpp
    Source/Song.cpp
    Source/ChordScheduler.cpp
    Source/Theory/ChordTheory.cpp
    Source/Theory/ChordWalk.cpp
    Source/Theory/ChordRecognition.cpp
    Source/Performance.cpp
    Source/ProgressionXml.cpp
    Source/PresetStore.cpp
    Source/Import/ChordImport.cpp
)

# Shared by the plugin and the console tests: the theory and timing code has no
# JUCE GUI dependency, which is what lets it be tested without a DAW.
add_library(TrackDraftCore STATIC
    Source/Progression.cpp
    Source/Song.cpp
    Source/ChordScheduler.cpp
    Source/Theory/ChordTheory.cpp
    Source/Theory/ChordWalk.cpp
    Source/Theory/ChordRecognition.cpp
    Source/Performance.cpp
    Source/ProgressionXml.cpp
    Source/PresetStore.cpp
    Source/Import/ChordImport.cpp
)
target_include_directories(TrackDraftCore PUBLIC Source)
target_link_libraries(TrackDraftCore PUBLIC juce::juce_audio_basics juce::juce_core)
target_compile_definitions(TrackDraftCore PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:TrackDraftHarmony,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:TrackDraftHarmony,JUCE_VERSION>"
)
target_link_libraries(TrackDraftCore PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)

target_include_directories(TrackDraftHarmony PRIVATE Source)
target_link_libraries(TrackDraftHarmony
    PRIVATE
        TrackDraftCore
        juce::juce_audio_utils
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
target_compile_definitions(TrackDraftHarmony PUBLIC
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
)

# Console test target: `cmake --build build --target TrackDraftTests && ./build/TrackDraftTests_artefacts/TrackDraftTests`
juce_add_console_app(TrackDraftTests PRODUCT_NAME "TrackDraftTests")
target_sources(TrackDraftTests PRIVATE Tests/PluginTests.cpp)
target_link_libraries(TrackDraftTests PRIVATE TrackDraftCore juce::juce_audio_utils)
