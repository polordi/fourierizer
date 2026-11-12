# H0 · Fundaciones: bitácora

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

## Qué construimos

Un plugin de prueba (*spike*), **Fourierizer H0 Spike**: un instrumento de onda senoidal que responde a MIDI, con una interfaz web y una entrada sidechain. No es Fourierizer. Su única función es probar que la arquitectura elegida funciona dentro de FL Studio antes de construir encima de ella.

## Archivos y qué hace cada uno

| Archivo | En simple | En técnico |
|---|---|---|
| [CMakeLists.txt](../../../CMakeLists.txt) | La receta general: C++20, descarga JUCE 8.0.15 y dice a dónde copiar los plugins. | Proyecto raíz: `FetchContent` de JUCE, runtime MSVC estático (sin redistribuibles), binario universal en macOS, `VST3_COPY_DIR` por usuario. |
| [spikes/h0-hello/CMakeLists.txt](../../../spikes/h0-hello/CMakeLists.txt) | La "ficha" del plugin: nombre, fabricante, que es instrumento, que recibe MIDI y que usa interfaz web. | `juce_add_plugin` (IS_SYNTH, NEEDS_MIDI_INPUT, NEEDS_WEBVIEW2, códigos de fabricante/plugin) + `juce_add_binary_data` para incrustar la UI en el binario. |
| [PluginProcessor](../../../spikes/h0-hello/source/PluginProcessor.cpp) | El motor: genera la senoidal cuando tocas, mide lo que entra por el sidechain y guarda el volumen en tu proyecto. | `AudioProcessor` con `Synthesiser` de 8 voces, `AudioProcessorValueTreeState` (parámetro `gain` con ID versionado), RMS del bus de entrada en un `std::atomic`, `SmoothedValue` contra *zipper noise*, estado serializado a XML. |
| [PluginEditor](../../../spikes/h0-hello/source/PluginEditor.cpp) | La ventana: carga la página web y la conecta con el motor. | `AudioProcessorEditor` con un `WebBrowserComponent` (backend WebView2), resource provider que sirve la UI desde `BinaryData`, `WebSliderRelay` + `WebSliderParameterAttachment`, una *native function* y un `Timer` a 30 Hz que emite eventos. |
| [ui/](../../../spikes/h0-hello/ui/) | La página web de la interfaz. | HTML/CSS/JS como módulo ES; usa `juce/index.js` (el bridge oficial de JUCE): `getSliderState`, `getNativeFunction`, `window.__JUCE__.backend.addEventListener`. |
| [scripts/build.ps1](../../../scripts/build.ps1) | Un botón de "compilar" que prepara el entorno y construye todo. | Entra al *Developer Shell* de VS (x64), configura CMake con Ninja en `build/<config>` y compila. |

## Conceptos nuevos

**Códigos de fabricante y de plugin**
- *En simple:* cada plugin tiene una "placa" con dos claves: quién lo hizo y cuál es. El DAW las usa para reconocerlo en tus proyectos viejos.
- *En técnico:* `PLUGIN_MANUFACTURER_CODE` (4 caracteres, el primero en mayúscula) y `PLUGIN_CODE` forman el **plugin ID** de VST3/AU. **No se pueden cambiar nunca** después de publicar; si cambian, los proyectos guardados no encuentran el plugin. El spike usa `FzSp` para no chocar con el Fourierizer real.

**Incrustar la UI en el binario**
- *En simple:* la página web no vive en una carpeta aparte; va "cosida" dentro del archivo del plugin, así que no se puede perder ni desordenar.
- *En técnico:* `juce_add_binary_data` genera `BinaryData.cpp/.h` con los bytes de cada archivo. El **resource provider** los sirve cuando la WebView pide una URL bajo `getResourceProviderRoot()`.

**La carpeta de datos de WebView2**
- *En simple:* el navegador interno necesita una carpeta donde escribir. Si intenta usar la carpeta donde está instalado FL (que es de solo lectura), la ventana se queda en blanco. Por eso le damos una carpeta temporal.
- *En técnico:* `WinWebView2::withUserDataFolder`. Es un error clásico de plugins con WebView2 en hosts instalados en `Program Files`.

**Hablar entre hilos sin bloquear**
- *En simple:* el motor anota el nivel del sidechain en una "pizarra" que la interfaz lee 30 veces por segundo. Ninguno espera al otro.
- *En técnico:* `std::atomic<float>` con `memory_order_relaxed`, escrito en `processBlock` y leído en `timerCallback` (message thread). Sin mutex, el audio thread se mantiene **real-time safe**.

**Validación**
- *En simple:* pluginval es el examen que cualquier estudio serio pasa antes de publicar. Lo pasamos en nivel 8 de 10.
- *En técnico:* `pluginval --strictness-level 8 --skip-gui-tests`: apertura fría/caliente, procesamiento con distintos sample rates y tamaños de bloque, estado, automatización, seguridad de hilos en parámetros, buses, validador VST3 y fuzzing de parámetros.

## Resultados

- ✅ Compila en Release con MSVC 14.44 / JUCE 8.0.15, sin errores.
- ✅ pluginval nivel 8 (sin GUI): SUCCESS.
- ⏳ Prueba 1 en FL (MIDI → sonido): pendiente.
- ⏳ Prueba 2 en FL (UI web ↔ parámetro): pendiente.
- ⏳ Prueba 3 en FL (sidechain a un instrumento): pendiente.
