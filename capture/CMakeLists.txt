# Fourierizer Capture: a mixer effect that records what passes through its track into
# Documents/Fourierizer/Captures, where the Fourierizer instrument lists it (FL Studio gives
# instruments no audio input; see PLAN §3.2).
#
# Plugin identity is PERMANENT once released (manufacturer Wvsp, plugin Fzcp).

juce_add_plugin(FourierizerCapture
    VERSION                 0.1.0
    COMPANY_NAME            "waves_p"
    BUNDLE_ID               "com.wavesp.fourierizercapture"
    PLUGIN_MANUFACTURER_CODE Wvsp
    PLUGIN_CODE             Fzcp
    PRODUCT_NAME            "Fourierizer Capture"
    DESCRIPTION             "Records a mixer track for Fourierizer"
    FORMATS                 VST3
    IS_SYNTH                FALSE
    NEEDS_MIDI_INPUT        FALSE
    NEEDS_MIDI_OUTPUT       FALSE
    IS_MIDI_EFFECT          FALSE
    VST3_CATEGORIES         Fx Tools
    COPY_PLUGIN_AFTER_BUILD TRUE
    VST3_COPY_DIR           "${FZ_VST3_COPY_DIR}")

target_sources(FourierizerCapture PRIVATE
    source/CaptureProcessor.cpp
    source/CaptureEditor.cpp)

target_include_directories(FourierizerCapture PRIVATE "${CMAKE_SOURCE_DIR}/shared")

target_compile_definitions(FourierizerCapture PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(FourierizerCapture
    PRIVATE
        juce::juce_audio_utils
        juce::juce_audio_formats
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

# ---- Capture test: the processor with a fake transport (writes and deletes FzTest*.wav)
juce_add_console_app(FourierizerCaptureTest PRODUCT_NAME "FourierizerCaptureTest")
target_sources(FourierizerCaptureTest PRIVATE tests/CaptureTest.cpp source/CaptureProcessor.cpp source/CaptureEditor.cpp)
target_include_directories(FourierizerCaptureTest PRIVATE "${CMAKE_SOURCE_DIR}/shared")
target_compile_definitions(FourierizerCaptureTest PRIVATE
    JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1
    JucePlugin_Name="Fourierizer Capture")
target_link_libraries(FourierizerCaptureTest PRIVATE
    juce::juce_audio_utils juce::juce_audio_formats
    juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
