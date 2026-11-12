# H0 spike: a sine-wave instrument that proves, inside FL Studio, that
#   (1) a JUCE VST3 instrument builds, loads and plays MIDI,
#   (2) a WebView UI renders and drives a host parameter,
#   (3) audio can reach an instrument through a sidechain (aux) input bus.
# It uses its own plugin code so it never collides with the real Fourierizer.

juce_add_plugin(FourierizerSpike
    COMPANY_NAME            "waves_p"
    BUNDLE_ID               "com.wavesp.fourierizer.spike"
    PLUGIN_MANUFACTURER_CODE Wvsp
    PLUGIN_CODE             FzSp
    PRODUCT_NAME            "Fourierizer H0 Spike"
    FORMATS                 VST3 Standalone
    IS_SYNTH                TRUE
    NEEDS_MIDI_INPUT        TRUE
    NEEDS_MIDI_OUTPUT       FALSE
    IS_MIDI_EFFECT          FALSE
    VST3_CATEGORIES         Instrument Synth
    NEEDS_WEBVIEW2          TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE
    VST3_COPY_DIR           "${FZ_VST3_COPY_DIR}")

juce_add_binary_data(FourierizerSpikeUI
    NAMESPACE SpikeUI
    SOURCES
        ui/index.html
        ui/main.js
        "${juce_SOURCE_DIR}/modules/juce_gui_extra/native/javascript/index.js"
        "${juce_SOURCE_DIR}/modules/juce_gui_extra/native/javascript/check_native_interop.js")

target_sources(FourierizerSpike PRIVATE
    source/PluginProcessor.cpp
    source/PluginEditor.cpp)

target_compile_definitions(FourierizerSpike PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(FourierizerSpike
    PRIVATE
        FourierizerSpikeUI
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)
