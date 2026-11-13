# fourierizer-core: the synthesis engine in C++ (no JUCE). Built as part of the whole project,
# or on its own for fast iteration:  cmake -S core -B build/core -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake_minimum_required(VERSION 3.25)

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FourierizerCore VERSION 0.4.0 LANGUAGES CXX)
    set(CMAKE_CXX_STANDARD 20)
    set(CMAKE_CXX_STANDARD_REQUIRED ON)
    set(CMAKE_CXX_EXTENSIONS OFF)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

option(FZ_CORE_TESTS "Build the fourierizer-core tests and benchmark" ON)

add_library(fourierizer-core STATIC
    src/fft.cpp
    src/windows.cpp
    src/stft.cpp
    src/mask.cpp
    src/resample.cpp
    src/render.cpp
    src/ops.cpp
    src/spectrogram.cpp)
add_library(fourierizer::core ALIAS fourierizer-core)
target_include_directories(fourierizer-core PUBLIC include)
target_compile_features(fourierizer-core PUBLIC cxx_std_20)
find_package(Threads REQUIRED)
target_link_libraries(fourierizer-core PUBLIC Threads::Threads)
if(MSVC)
    target_compile_options(fourierizer-core PRIVATE /W4 /permissive- /fp:precise)
else()
    # No -ffast-math: the golden tests compare to the Python reference to 1e-9.
    target_compile_options(fourierizer-core PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(FZ_CORE_TESTS)
    include(FetchContent)
    FetchContent_Declare(nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
        URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(nlohmann_json)

    enable_testing()
    add_executable(fourierizer-core-tests tests/golden_test.cpp)
    target_link_libraries(fourierizer-core-tests PRIVATE fourierizer-core nlohmann_json::nlohmann_json)
    target_compile_definitions(fourierizer-core-tests PRIVATE
        FZ_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../python/golden/data/")
    add_test(NAME golden COMMAND fourierizer-core-tests)

    add_executable(fourierizer-core-bench tests/bench.cpp)
    target_link_libraries(fourierizer-core-bench PRIVATE fourierizer-core)
endif()
