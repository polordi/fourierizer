# H5 · Plugin MVP (v2.0): bitácora

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

## Qué construimos

**Fourierizer** como instrumento VST3 (y app Standalone): la misma interfaz del demo, ahora dentro de FL Studio, con el motor C++ de H4 detrás. Cargas sonidos, seleccionas, renderizas y lo tocas con tu teclado MIDI. Todo queda guardado en tu `.flp`.

Identidad permanente del plugin: fabricante `waves_p` (`Wvsp`), plugin `Fzrz`, `com.wavesp.fourierizer`. **No se cambia nunca** después de publicar: si cambia, FL ya no encuentra el plugin en tus proyectos guardados.

## Cómo está armado

| Pieza | En simple | En técnico |
|---|---|---|
| [Sampler](../../../plugin/source/Sampler.cpp) | Lo que suena: hasta 24 notas a la vez del resultado, más un reproductor aparte para escuchar una capa sola. | Voces *Tape* con interpolación Hermite cúbica, paso 2^((n−r)/12)·48000/sr del host; envolvente (ataque lineal, decaimiento exponencial con τ = d/3, release lineal); pedal de sustain (CC64); voice stealing por antigüedad. |
| [Engine](../../../plugin/source/Engine.cpp) | El "cuarto de máquinas": guarda tus cuatro sonidos, hace los cálculos pesados en segundo plano y guarda todo en el proyecto. | `juce::ThreadPool` de 3 hilos con fourierizer-core: decodificación (WAV, AIFF, FLAC, MP3, OGG) con conversión a 48 kHz, espectrogramas, render (Sum con 4 hilos, Max/Cross/Product), preview. Cancela el render anterior cuando llega uno nuevo. |
| [Processor](../../../plugin/source/PluginProcessor.cpp) | El plugin que FL ve: recibe notas, devuelve audio y expone las perillas para que las conectes a tu MPK. | `AudioProcessor` con `AudioProcessorValueTreeState`: Attack, Decay, Sustain, Release, Root y Volume como parámetros del host; estado = `ValueTree` binario con el proyecto de la UI, la última petición de render y cada fuente en **FLAC 24-bit**. |
| [Editor](../../../plugin/source/PluginEditor.cpp) | La ventana: carga la interfaz web y la conecta con el motor. | `WebBrowserComponent` (WebView2 en Windows, WKWebView en Mac) con 19 *native functions*, eventos a 30 Hz (`play`, `params`, `projectLoaded`) y un *resource provider* que sirve la UI y los datos binarios. |
| [plugin-host.ts](../../../ui/src/plugin-host.ts) | El "traductor" del lado de la interfaz. | Implementa `Host` sobre el puente de JUCE (`__juce__invoke` / `__juce__complete`); sube archivos en trozos base64 y baja las imágenes con `fetch("/data/<key>")`. |

## Conceptos nuevos

**El plugin funciona con la ventana cerrada**
- *En simple:* cuando abres tu proyecto en FL, Fourierizer ya suena aunque no abras su ventana. La ventana es solo para editar.
- *En técnico:* el estado guarda la última petición de render; `setStateInformation` decodifica las fuentes y la vuelve a ejecutar en segundo plano. El *source of truth* del audio está en C++; la UI espeja su propio estado (selecciones, perillas) como JSON que C++ guarda tal cual.

**El hilo de audio nunca espera**
- *En simple:* el sonido se calcula en un hilo que no puede detenerse ni un instante, o se escucha un "click". Por eso nunca pide memoria, nunca espera a otros hilos y nunca borra nada: otro hilo hace la limpieza.
- *En técnico:* los buffers nuevos llegan con un `SpinLock` en modo *try-lock* (si está ocupado, se toman en el siguiente bloque); las notas de la UI por un `AbstractFifo` sin locks; los buffers viejos se liberan en el *message thread* con un **release pool** (el pool conserva una referencia, así el hilo de audio nunca suelta la última).

**Datos grandes entre la interfaz y C++**
- *En simple:* mandar un archivo de audio o una imagen como texto es lento. Las imágenes viajan como archivos que la interfaz "descarga" del propio plugin, y los sonidos suben en pedazos.
- *En técnico:* el *resource provider* sirve `/data/<key>` como `application/octet-stream` (sin JSON ni base64 de bajada); las subidas usan base64 en trozos de 1.5 MB porque las *native functions* solo aceptan JSON.

**Una sola interfaz, dos anfitriones**
- *En simple:* el demo del navegador y el plugin usan exactamente el mismo código de interfaz; solo cambia a quién le pide las cosas.
- *En técnico:* `insidePlugin()` detecta `window.__JUCE__` y elige `PluginHost` o `BrowserHost`. El plugin además escala el layout aprobado de 1440×900 a cualquier tamaño de ventana (CSS `zoom`), y trae sus fuentes incrustadas para funcionar sin internet.

## Cómo se probó (2026-11-12)

- ✅ pluginval nivel 8 (sin GUI): SUCCESS (estado, restauración, automatización, seguridad de hilos en parámetros, buses, fuzzing).
- ✅ Prueba de punta a punta en la app **Standalone** (misma WebView2 que en FL), manejada con puppeteer por el puerto de depuración de WebView2: soltar un WAV de 44.1 kHz (se convierte a 48 kHz), espectrograma, dibujar, render, nota con el teclado de la computadora (cabezal avanza), ▶ de la capa, *Send to layer*, Max, cerrar y reabrir: **el proyecto se restaura** (capas, selección, operación, vista y resultado).
- ⏳ Lo que solo tú puedes probar: FL Studio, tu MPK Mini, cómo suena, y arrastrar el resultado al playlist.

## Ronda de feedback en FL (2026-11-13)

Primera prueba en FL Studio: "está funcionando perfecto". Tres cosas que faltaban:

| Nota | Qué se hizo |
|---|---|
| Quitar uno de los 4 sonidos, o vaciar todo | Botón ⏏ en cada capa (deja el slot vacío, con parámetros por defecto) y **New** arriba (vacía las cuatro capas y el resultado; conserva el sampler y el display). Ambos piden un segundo clic ("Sure?"), porque no se pueden deshacer. |
| Ajustar la escala de los espectrogramas, como en Wave Candy | Panel **Display**: escala Log / Lin, frecuencia mínima y máxima, *Range* (dB visibles: contraste) y *Gain* (brillo). Se guarda en el proyecto. |
| Comparar el sonido original de una capa contra su selección | Botón **Orig** junto al ▶: mientras suena, cambia entre la selección y el original, sincronizados y a la misma ganancia (crossfade de 12 ms). Con Orig encendido, ▶ también funciona en una capa sin selecciones. |

**Range y Gain sin recalcular**
- *En simple:* mover el contraste o el brillo es instantáneo, porque el motor ya mandó "qué tan fuerte es cada punto"; la interfaz solo vuelve a pintar.
- *En técnico:* la imagen del espectrograma dejó de traer colores ya decididos: cada píxel trae su nivel en pasos de ½ dB por debajo del pico (0 = pico, 255 = −127.5 dB). La UI aplica ((dB + gain + range) / range)^2.4 con una tabla de 256 entradas al pintar. Cambiar la escala o el rango de frecuencias sí pide un espectrograma nuevo, porque cambian los renglones.

**Mover selecciones en cualquier escala**
- *En técnico:* arrastrar una selección ya no multiplica frecuencias por una razón fija (eso solo valía en escala log): cada frecuencia se convierte a la posición vertical del eje actual, se desplaza y se convierte de regreso.

## Cómo probarlo en FL Studio

1. El plugin ya está en `%LOCALAPPDATA%\Programs\Common\VST3\Fourierizer.vst3` (la misma carpeta que el spike de H0, que ya registraste como VST3).
2. En FL: *Options → Manage plugins → Find installed plugins*. Debe aparecer **Fourierizer** (waves_p) como generador.
3. Agrégalo al Channel Rack y abre su ventana.

Qué revisar:

- Arrastra 2–4 sonidos tuyos desde el navegador de FL (o el Explorador) a las capas. MP3, WAV, FLAC, AIFF u OGG; hasta 60 s.
- Selecciona, prueba Sum / Max / Cross / Prod y toca con el MPK. Las perillas ATK/DEC/SUS/REL y ROOT se pueden ligar al MPK con clic derecho → *Link to controller* (en FL aparecen como parámetros del plugin).
- **Drag** (junto a WAV, en el módulo Result): arrastra el resultado al playlist. Si no funciona, **WAV** lo exporta a un archivo.
- Guarda el proyecto, ciérralo y ábrelo: todo debe volver (y sonar sin abrir la ventana).
- Haz un beat con un sonido fourierizado: es la **definición de terminado de la v2.0**.

Plantilla de feedback: ✅ qué funciona · ❌ qué no · ➕ qué falta · ⭐ prioridad.
