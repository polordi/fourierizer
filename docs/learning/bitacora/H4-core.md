# H4 · Core C++: bitácora

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

## Qué construimos

`fourierizer-core`: el motor de síntesis en C++, el lenguaje en el que viven los plugins. Es una biblioteca **sin JUCE**: no sabe nada de plugins, ventanas ni DAWs; solo recibe audio y selecciones y devuelve audio. En H5 el plugin la usa por dentro.

## Archivos y qué hace cada uno

| Archivo | En simple | En técnico |
|---|---|---|
| [fft](../../../core/src/fft.cpp) | La transformada de Fourier rápida: pasa un pedazo de sonido a frecuencias y de regreso. | FFT real de tamaño N por empaquetado en una compleja de N/2 (radix-2 iterativa, *twiddles* precalculados). Convenciones de numpy: `rfft` sin normalizar, `irfft` divide entre N. |
| [windows](../../../core/src/windows.cpp) | Las 7 ventanas que suavizan cada pedazo de sonido. | Ventanas periódicas; Kaiser = `numpy.kaiser(L+1, β)[:-1]`; Bessel I₀ por serie de potencias. |
| [stft](../../../core/src/stft.cpp) | Corta el sonido en pedazos, aplica la selección a cada uno y los vuelve a pegar. | STFT con marcos centrados e ISTFT de mínimos cuadrados (Σw·y / Σw²) en *streaming*: memoria O(N) además de entrada y salida; los marcos con máscara nula se saltan sus FFT. |
| [mask](../../../core/src/mask.cpp) | Convierte tus rectángulos, lassos y fades en "cuánto deja pasar" cada punto del espectrograma. | Rasterizador de selecciones en (t, log₂ f) con distancia con signo, rampa de coseno, combinación en orden y fades por renglón (intervalos del polígono precalculados por bin). |
| [resample](../../../core/src/resample.cpp) | Cambia la velocidad del sonido (Tape) y convierte archivos de 44.1 kHz a la frecuencia del proyecto. | Sinc con ventana Kaiser (24 cruces por cero, tabla de 512 puntos por cruce con interpolación lineal), filtro a la nueva Nyquist cuando acorta. |
| [render](../../../core/src/render.cpp) | Junta las cuatro capas con su volumen y su retraso, y normaliza el resultado. | `synthesizeLayer` + `mix` (ganancia, offset, mono → estéreo, normalización a −0.3 dBFS). Capas en paralelo con resultados idénticos; bandera de cancelación. |
| [tests/golden_test](../../../core/tests/golden_test.cpp) | El examen: el motor C++ debe dar lo mismo que Python. | Carga `python/golden/data/*.json` (nlohmann/json, solo en pruebas) y exige error < 1e-9; además propiedades (reconstrucción perfecta, NOLA, cancelación). |
| [tests/bench](../../../core/tests/bench.cpp) | Mide qué tan rápido renderiza. | 4 capas estéreo de 30 s a 48 kHz en tres mallas, con 1 y 4 hilos. |
| [scripts/test-core.ps1](../../../scripts/test-core.ps1) | Un botón para compilar y probar solo el motor. | Configura `core/` por separado (sin descargar JUCE) en `build/core-release`. |

## Conceptos nuevos

**Una biblioteca sin el framework**
- *En simple:* el motor no depende de JUCE ni del plugin. Así se puede probar solo, en segundos, y reutilizar en otros proyectos (la futura fábrica de plugins, H11).
- *En técnico:* `add_library(fourierizer-core STATIC …)` con API en `include/fourierizer/`, C++20 estándar y `Threads` como única dependencia. El `CMakeLists.txt` de `core/` funciona como subproyecto o como proyecto raíz.

**Una sola referencia para tres motores**
- *En simple:* Python, el navegador y el plugin hacen la misma cuenta. Para que nunca se separen, los tres se comparan contra los mismos resultados de referencia en cada subida a GitHub.
- *En técnico:* los golden files se generan con Python y los consumen `ui/test` y `core/tests`. En esta etapa el resampler de *Tape* pasó a Python (antes usaba `resample_poly`) para que la referencia sea la misma que usan el navegador y el C++.

**Hilos y cancelación**
- *En simple:* cada capa se calcula en un núcleo distinto del procesador, al mismo tiempo. Si cambias algo a media cuenta, el cálculo viejo se puede detener para empezar el nuevo.
- *En técnico:* `RenderOptions::threads` reparte las capas entre hilos (cada una es independiente y la mezcla es secuencial, así que el resultado es bit a bit igual). `RenderOptions::cancel` es un `std::atomic<bool>` que se revisa en cada marco y lanza `fz::Cancelled`. En el plugin el render corre en un hilo de trabajo, **nunca** en el hilo de audio.

**Sin -ffast-math**
- *En simple:* hay una opción que acelera las cuentas a cambio de redondearlas distinto. No la usamos, porque queremos dar exactamente lo mismo que la referencia.
- *En técnico:* `/fp:precise` en MSVC y sin `-ffast-math` en GCC/Clang: la asociatividad y los NaN se respetan, y la diferencia con Python queda en ~1e-15.

## Resultados (2026-11-12)

- ✅ Golden tests: ventanas (1e-12), FFT, resíntesis en 5 mallas, máscaras con fades, render (1 y 4 hilos) y resampler: diferencias de 0 a 1.1e-15.
- ✅ Compila sin advertencias con MSVC `/W4`; en CI también con GCC (Linux) y Clang (macOS, binario universal).
- ✅ Benchmark local (24 hilos de hardware), 4 capas estéreo de 30 s:

  | Malla | 1 hilo | 4 hilos |
  |---|---|---|
  | Hann L=4096 H=512 | 1.18 s (25× tiempo real) | 0.36 s (84×) |
  | Hann L=2048 H=256 | 1.10 s (27×) | 0.35 s (87×) |
  | Blackman–Harris L=16384 H=2048 | 1.44 s (21×) | 0.44 s (69×) |

  *En simple:* un proyecto típico se renderiza en menos de medio segundo.

- ⏭️ Fuera de H4, a propósito: las operaciones distintas de la suma (Max, Cross, Product, Subtract) entran en C++ solo si te convencen (H9); la imagen del espectrograma y el puente con la UI van en H5.
