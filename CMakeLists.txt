cmake_minimum_required(VERSION 3.25)

project(Fourierizer VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Universal binary on macOS (Apple Silicon + Intel); ignored elsewhere.
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "")
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")

# Static MSVC runtime: the plugin does not depend on a VC++ redistributable being installed.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# ---- Dependencies -------------------------------------------------------------------------
include(FetchContent)
set(FETCHCONTENT_QUIET OFF)
# Dependencies are pinned to exact tags: once downloaded, never re-check them on reconfigure.
set(FETCHCONTENT_UPDATES_DISCONNECTED ON CACHE BOOL "")

FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.15
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE)
FetchContent_MakeAvailable(JUCE)

# ---- Where built plugins are copied ---------------------------------------------------------
# Per-user VST3 folder (no admin rights needed). Add it once to FL Studio's plugin search paths.
if(WIN32)
    file(TO_CMAKE_PATH "$ENV{LOCALAPPDATA}/Programs/Common/VST3" FZ_VST3_COPY_DIR)
elseif(APPLE)
    set(FZ_VST3_COPY_DIR "$ENV{HOME}/Library/Audio/Plug-Ins/VST3")
endif()

# ---- Targets -------------------------------------------------------------------------------
enable_testing()
add_subdirectory(core)          # fourierizer-core: the engine (no JUCE) + golden tests
add_subdirectory(spikes/h0-hello)
