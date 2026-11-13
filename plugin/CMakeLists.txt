# Fourierizer: the instrument plugin (VST3 + Standalone). The engine is fourierizer-core; the
# window is the web UI from ui/ (built by esbuild into one HTML file and embedded here).
#
# Plugin identity is PERMANENT once released: changing the manufacturer or plugin code breaks
# every saved project that uses it.

# ---- The web UI: rebuild ui/dist/index.html whenever its sources change --------------------
set(FZ_UI_DIR "${CMAKE_SOURCE_DIR}/ui")
set(FZ_UI_HTML "${FZ_UI_DIR}/dist/index.html")
find_program(FZ_NPM NAMES npm.cmd npm HINTS "$ENV{ProgramFiles}/nodejs" "$ENV{ProgramW6432}/nodejs" /usr/local/bin /opt/homebrew/bin)
file(GLOB_RECURSE FZ_UI_SOURCES CONFIGURE_DEPENDS "${FZ_UI_DIR}/src/*" "${FZ_UI_DIR}/build.mjs")
if(FZ_NPM AND EXISTS "${FZ_UI_DIR}/node_modules")
    add_custom_command(OUTPUT "${FZ_UI_HTML}"
        COMMAND "${FZ_NPM}" run build
        WORKING_DIRECTORY "${FZ_UI_DIR}"
        DEPENDS ${FZ_UI_SOURCES}
        COMMENT "Building the Fourierizer web UI"
        VERBATIM)
elseif(NOT EXISTS "${FZ_UI_HTML}")
    message(FATAL_ERROR "The plugin embeds ui/dist/index.html. Install Node.js, then run `npm ci` in ui/.")
else()
    message(WARNING "Node.js or ui/node_modules not found: the plugin embeds the existing ui/dist/index.html and will NOT pick up UI changes.")
endif()

juce_add_plugin(Fourierizer
    VERSION                 0.5.0
    COMPANY_NAME            "waves_p"
    BUNDLE_ID               "com.wavesp.fourierizer"
    PLUGIN_MANUFACTURER_CODE Wvsp
    PLUGIN_CODE             Fzrz
    PRODUCT_NAME            "Fourierizer"
    DESCRIPTION             "Time-frequency selection synth"
    FORMATS                 VST3 Standalone
    IS_SYNTH                TRUE
    NEEDS_MIDI_INPUT        TRUE
    NEEDS_MIDI_OUTPUT       FALSE
    IS_MIDI_EFFECT          FALSE
    VST3_CATEGORIES         Instrument Synth Sampler
    NEEDS_WEBVIEW2          TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE
    VST3_COPY_DIR           "${FZ_VST3_COPY_DIR}")

juce_add_binary_data(FourierizerUI
    HEADER_NAME FourierizerUIData.h
    NAMESPACE   FourierizerUIData
    SOURCES     "${FZ_UI_HTML}")

target_sources(Fourierizer PRIVATE
    source/Sampler.cpp
    source/Engine.cpp
    source/PluginProcessor.cpp
    source/PluginEditor.cpp)

target_compile_definitions(Fourierizer PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_USE_MP3AUDIOFORMAT=1
    JUCE_USE_FLAC=1
    JUCE_USE_OGGVORBIS=1
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(Fourierizer
    PRIVATE
        FourierizerUI
        fourierizer::core
        juce::juce_audio_utils
        juce::juce_audio_formats
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)
