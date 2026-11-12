# Fourierizer 2 — Plan maestro

> Estado: **borrador 0.1** · 2026-11-11 · documento vivo (se actualiza al cerrar cada hito)

**Cómo leer este documento.** Las partes de software vienen en pares:

- **En simple:** explicación para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria. Los términos clave van en **negritas** y se acumulan en [docs/learning/01-plugins-101.md](../learning/01-plugins-101.md).

Las partes matemáticas van directo en notación formal.

---

## 1. Visión

**La esencia (no negociable).** Fourierizer es una herramienta que:

1. toma cualquier archivo de audio;
2. muestra la matriz de coeficientes de su transformada de Fourier de tiempo corto (STFT);
3. deja seleccionar las partes deseadas de cada sonido;
4. sintetiza un sonido nuevo a partir de esas selecciones.

**El producto 2.0.**

- Un **instrumento VST3** para FL Studio (y cualquier DAW): cargas o grabas de 1 a 4 sonidos, seleccionas regiones de sus espectrogramas, sintetizas y tocas el resultado con tu teclado MIDI.
- Un **documento teórico** con el rigor de la tesis, aterrizado para productores y diseñadores de sonido.
- **Demos interactivos** de la interfaz, publicados como artifact, para darme feedback continuo.

**Definición de terminado de la v2.0.** Puedo tomar de 2 a 4 sonidos cualesquiera, sintetizar un sonido resultante y usarlo como instrumento en una de mis composiciones.

---

## 2. Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| D1 | Tipo de plugin | **Instrumento VST3**, con entrada de audio auxiliar para grabar desde el DAW (§3.2) |
| D2 | Cómo se toca | **Switch Tape / Spectral** en la interfaz (confirmado). Tape sale en la v2.0 (H5); Spectral es la prioridad inmediata siguiente (H6). Export a WAV/arrastrar (§3.1) |
| D3 | Automatización | No es objetivo. Los parámetros de reproducción se exponen al host, así que los knobs del controlador funcionan gratis (§3.7) |
| D4 | Fuentes | Arrastrar archivos **y** grabar audio del DAW. **Resuelto por el spike H0 (2026-11-12):** FL Studio no da entrada de audio a generadores, así que la captura se hace con un plugin compañero **Fourierizer Capture** (efecto) que escribe en una carpeta compartida. El instrumento conserva su bus sidechain para los hosts que sí lo enrutan (§3.2) |
| D5 | Duración máxima por fuente | **60 s** (ajustable si en la práctica sobra o falta) |
| D6 | Capas | **4 slots** + **iteraciones**: el resultado puede volver como fuente de una nueva síntesis (§3.5) |
| D7 | Ventanas | Rect, Hann, Hamming, Blackman, Blackman-Harris, Kaiser(β), Gauss(σ) y Flat-top; L, N y H separados; **multirresolución** en un hito posterior (§3.4) |
| D8 | Selección | v2.0: rectángulos múltiples, lazo y borrador, todos con feather. Después: pincel, armónica, varita y booleanas |
| D9 | Operaciones entre capas | v2.0: **suma** con ganancia por capa. Las demás se **prueban en el demo web** y se decide con el oído si entran (§3.3) |
| D10 | Transformaciones por capa | Offset temporal, pitch (semitonos y cents) y ganancia. Time-stretch después |
| D11 | Fase creativa | Fuera de alcance |
| D12 | Lenguaje y framework | **C++20 + JUCE** (estándar de la industria). Implementa Claude; tú entiendes, no programas |
| D13 | Plataformas | Windows VST3 (probado por ti) + macOS VST3/AU compilados en CI y probados por amigos |
| D14 | Python | Sí, como **implementación de referencia** (§3.9) |
| D15 | Fábrica de plugins | **Repositorio aparte**, extraído al final, junto con skills de Claude (§12) |
| D16 | Idioma | Código, comentarios, commits y UI en inglés. Planes y material de aprendizaje en español. Documento teórico **en español primero; traducción al inglés al final** (H10) |
| D18 | Sonidos de prueba | **Nunca se suben al repo** (`v1/Documentadas/` está en `.gitignore`); los tests que los usan se saltan si no existen |
| D19 | Paleta de capas | Naranja · verde · azul · **morado/fucsia** |
| D17 | Publicación | Gratis primero; venta como opción futura (§3.8) |

---

## 3. Lo que quedó pendiente del cuestionario, explicado

### 3.1 ¿(a) o (b)? Las dos se tocan con el teclado

Ambas opciones te dejan tocar el resultado como instrumento. Lo que cambia es **qué le pasa a la duración** cuando tocas una nota distinta a la original.

- **(a) Tape — resampleo.**
  - *En simple:* como acelerar una cinta. Una octava arriba suena al doble de velocidad y dura la mitad. Es lo que hacen DirectWave o Fruity Slicer en FL.
  - *En técnico:* **keytracking** por **resampling** con tasa r = 2^((n − n₀)/12), donde n₀ es la **root note**. Para notas muy agudas se usan versiones prefiltradas por octava (**mipmaps**) para evitar **aliasing**.
- **(b) Spectral — pitch shift espectral.**
  - *En simple:* cambia la nota pero conserva la duración. Un pad de 20 s dura 20 s en cualquier tecla. Cuesta más cómputo y puede sonar algo "metálico".
  - *En técnico:* pitch shift por **phase vocoder** (con phase locking), o mejor aún, render offline por nota cacheado (**multisampling espectral**). Como el render es offline, podemos pagar la calidad por adelantado en vez de en tiempo real.

**Decisión (confirmada):** habrá un **switch *Tape / Spectral*** en la interfaz. La v2.0 (H5) sale con Tape, que es mucho más simple y valida todo el flujo. Spectral se implementa justo después (H6), porque es tu modo preferido. El switch ya aparece en la UI desde el demo.

### 3.2 ¿Instrumento, efecto o ambos?

*En simple:* en FL un instrumento vive en el **Channel Rack** y recibe notas. Un efecto vive en el **Mixer** y recibe audio. Fourierizer necesita sobre todo recibir notas, pero también "escuchar" otro canal para grabarlo.

*En técnico:* un solo **VST3 instrument** que declara un **auxiliary (sidechain) input bus**. Con un botón *Capture* en un slot, el plugin graba lo que entra por ese bus. **Resultado del spike H0 (2026-11-12):** en FL Studio 2026, el wrapper de un generador VST3 **no expone puertos de entrada**, ni con un bus principal (variante A) ni con un bus auxiliar (variante B). Su pestaña *Processing → Connections* muestra solo salidas. Decisión:

1. **Fourierizer Capture**: un plugin compañero de tipo efecto que se inserta en cualquier pista del mixer. Graba lo que pasa por ella y escribe WAVs en una carpeta compartida (p. ej. `Documents/Fourierizer/Captures`). El instrumento vigila la carpeta y muestra un navegador de capturas para cargarlas a un slot. No requiere comunicación entre procesos y funciona igual en cualquier DAW.
2. El instrumento **conserva su bus sidechain** (cuesta cero y ya está probado), para hosts que sí enrutan audio a instrumentos (Ableton, Reaper, Bitwig).
3. Siempre se puede grabar en FL (Edison o una pista) y arrastrar el clip al slot.

### 3.3 Operaciones entre capas: qué son

Sea χᵢ(m,k) la STFT enmascarada de la capa i. Para todas, excepto la suma, se necesita una malla tiempo-frecuencia común (ver §4.6).

| Operación | Fórmula (por celda) | Cómo suena |
|---|---|---|
| **Suma** (v2.0) | Σᵢ gᵢ χᵢ | Las selecciones suenan juntas, como "capas" con precisión espectral. Es la idea de la tesis |
| **Cross-synthesis** | \|χ_A\| · e^{i∠χ_B} | El "cuerpo" (magnitudes) de A con el "movimiento" (fases) de B. Ej.: el timbre de un pad con la articulación rítmica de una batería |
| **Vocoder / producto** | \|χ_A\| · \|χ_B\|^α · e^{i∠χ_B} | A "imprime" su envolvente espectral sobre B: la voz robot clásica, generalizada a cualquier par de sonidos. Multiplicar en frecuencia equivale a convolucionar en el tiempo |
| **Morph** | interpolación de \|χ\| (y de envolventes) entre A y B con λ(t) | El sonido se transforma de A a B a lo largo del tiempo, en vez de un crossfade de volumen |
| **Máximo espectral** | χ_{argmaxᵢ \|χᵢ\|} | En cada celda gana el sonido más fuerte. Un collage espectral: más definido que la suma, sin enmascaramiento mutuo |
| **Resta espectral** | max(\|χ_A\| − β\|χ_B\|, 0) · e^{i∠χ_A} | "Quitarle B a A". Como un ecualizador hecho con la forma exacta del otro sonido |

Recomendación: cuando tengas la v2.0 en la mano, probamos cross-synthesis y máximo en el demo web, que es barato, y decides si entran en la v2.1.

### 3.4 Multirresolución

La tesis ya permite una resolución distinta **por sonido** (cada uno tiene su w y H). La multirresolución **dentro** de un sonido usa ventanas largas para los graves (buena resolución en frecuencia, donde los armónicos están juntos) y ventanas cortas para los agudos (buena resolución temporal, donde viven los transientes). Hay dos caminos:

1. **Bandas:** se divide la señal con un banco de filtros de **reconstrucción perfecta** (p. ej. crossovers Linkwitz-Riley o filtros complementarios en frecuencia), cada banda con su propia STFT, y se suman al final.
2. **Transformada de Gabor no estacionaria (NSGT / CQT invertible):** una sola transformada con resolución que varía de forma continua con la frecuencia.

Plan: el hito H7 implementa (1), que encaja directo en nuestra arquitectura por capas. (2) entra en el documento teórico y queda como posible extensión. El reto de UI es mostrar mallas distintas en un mismo espectrograma; se resuelve porque **las selecciones se definen en unidades físicas** (§4.3), no en índices de matriz.

### 3.5 Iteraciones (síntesis recursiva)

Cada render produce audio, y el audio puede ser fuente. Un botón **"→ Slot"** manda el resultado a un slot. El proyecto guarda un **historial**: un grafo dirigido acíclico de renders, para saber de dónde salió cada sonido y poder rehacerlo. Matemáticamente es composición: y⁽²⁾ = F(y⁽¹⁾, x₅, x₆, x₇).

### 3.6 Cómo vas a dar feedback de diseño (respuesta a la pregunta 19)

Tú no vas a retocar código. El flujo es:

1. **Cuestionario de diseño interactivo** (artifact): preguntas guía y comparaciones visuales lado a lado ("¿A o B?"). Tus respuestas quedan guardadas para que yo las lea.
2. **Sistema de diseño** (artifact): paleta, tipografía, knobs, botones. Comentas directo sobre la página.
3. **Mockups** de 2 o 3 variantes del layout. Eliges y comentas.
4. **Demo interactivo**: la interfaz funcionando con audio real en el navegador.
5. Cada ronda usa una **plantilla fija de feedback**: qué funciona / qué no / qué falta / prioridad.

**Detalle técnico que lo hace posible.** La interfaz del plugin se construye con tecnología web (**WebView UI**, soportada por JUCE 8). Por eso **el demo del artifact y la interfaz real son el mismo código**: lo que apruebes en el demo es literalmente lo que verás en FL.

### 3.7 Controladores (MPK Mini)

*En simple:* si el plugin "publica" sus perillas hacia FL, FL ya sabe conectarlas a tu controlador (clic derecho → *Link to controller*). No hay que programar nada extra.

*En técnico:* se exponen los **host parameters** de reproducción (ADSR, gain, tune, filtro, etc.) vía `AudioProcessorValueTreeState`. VST3 no entrega **MIDI CC** crudos al plugin (los traduce a parámetros con `IMidiMapping`), así que el mapeo nativo del host es el camino estándar. Un *MIDI learn* propio queda opcional.

### 3.8 Publicar gratis y, quizá, vender

- **Gratis para amigos:** un instalador o un .zip con el `.vst3`.
  - En Windows, sin **code signing** aparece una advertencia de SmartScreen. Es tolerable entre amigos.
  - En Mac, sin **firma + notarización** de Apple (cuenta de desarrollador de pago anual), Gatekeeper bloquea el plugin y hay que desbloquearlo a mano.
- **Venta:** plataforma de pago (Gumroad, Lemon Squeezy, etc.), opcionalmente con licencias por clave.
- **Licencias de software (decidir antes de publicar).** JUCE se puede usar bajo **AGPLv3** (el código de Fourierizer tendría que ser open source) o bajo licencias comerciales, que tienen un nivel gratuito para ingresos pequeños. El SDK de VST3 de Steinberg pasó recientemente a una licencia permisiva. *Verificaremos los términos vigentes en el hito H10;* no los asumo de memoria.

### 3.9 ¿Por qué mantener Python?

1. **Laboratorio:** probar una idea matemática (una ventana, una operación, una máscara) cuesta minutos en numpy y horas en C++.
2. **Oráculo de pruebas:** Python genera "respuestas correctas" (**golden files**) y el C++ debe reproducirlas con un error menor que ε. Así se verifica que el plugin hace exactamente lo que dice la teoría.
3. **Figuras del documento teórico,** generadas por código y reproducibles.

---

## 4. Modelo matemático del motor

### 4.1 Notación

- Fuente i ∈ {1,…,4}: señal xᵢ[n] a la frecuencia del proyecto F_s. Las fuentes se **resamplean** a F_s al importarse; no es un parámetro del usuario como en la v1.
- Parámetros STFT por capa: ventana wᵢ de largo Lᵢ, tamaño de FFT Nᵢ ≥ Lᵢ (zero-padding), hop Hᵢ.
- STFT: χᵢ(m,k) = Σₙ xᵢ[n + mHᵢ] wᵢ[n] e^{−2πikn/Nᵢ}, con k = 0,…,Nᵢ/2.
- Malla física: t_m = mHᵢ/F_s, f_k = kF_s/Nᵢ.

### 4.2 Pipeline por capa

```
xᵢ ──► Tᵢ (pitch ρᵢ) ──► STFT(wᵢ,Lᵢ,Nᵢ,Hᵢ) ──► ⊙ Mᵢ ──► ISTFT ──► ×gᵢ ──► delay τᵢ ──┐
                                                                                    Σ ──► y
x_j ─── (igual) ───────────────────────────────────────────────────────────────────┘
```

y[n] = Σᵢ gᵢ · ( ISTFTᵢ( Mᵢ ⊙ STFTᵢ( Tᵢ xᵢ ) ) )[n − τᵢF_s]

- **El pitch se aplica antes de la STFT**, para que lo que ves sea lo que seleccionas: los armónicos aparecen ya desplazados.
- **El offset se aplica después.** Un retardo puro conmuta con todo lo lineal e invariante, así que no hace falta recalcular nada.
- **No hay remuestreo de matrices** (corrige el problema de fase de la v1). La linealidad de la ISTFT permite reconstruir cada capa en su propia malla y sumar en el tiempo.

### 4.3 Máscaras independientes de la resolución

Una selección S es un objeto geométrico en el plano físico (t, φ), con φ = log₂ f (eje logarítmico, perceptual):

- rectángulo, polígono (lazo), trazo de pincel o borrador con radio;
- cada objeto tiene un modo (añadir/restar), una ganancia a ∈ [0,1] y un feather δ.

Para el objeto s, su máscara es

  M_s(t,φ) = a_s · σ( d_s(t,φ) / δ_s ),

donde d_s es la distancia con signo al borde (positiva adentro) y σ es una rampa suave (p. ej. una sigmoide de tipo coseno). Las máscaras se combinan en orden de capas, como en un editor de imagen: M ← M + (1−M)·M_s para añadir y M ← M·(1−M_s) para restar. Al final se **muestrea en la malla de la capa**: Mᵢ(m,k) = M(t_m, log₂ f_k).

**Consecuencias.** Puedes cambiar N, H o la ventana sin perder tu selección. Las máscaras suaves reducen el ringing y el *musical noise* que producen los bordes duros (el documento teórico explicará por qué con el operador de proyección de la ISTFT).

### 4.4 Estéreo

Se analiza y se muestra **Mid** (L+R)/2. La misma máscara se aplica a L y R, o a M y S, para conservar la imagen estéreo. Opción de capa: *mono / stereo*.

### 4.5 Restricciones y validaciones

- **NOLA** (Nonzero Overlap-Add): Σ_m wᵢ²[n − mHᵢ] > 0 para todo n, que garantiza que la ISTFT existe. La UI advierte o impide H > L.
- La ISTFT usa la normalización de mínimos cuadrados (Griffin–Lim 1984): x̂[n] = Σ_m w[n−mH]·y_m[n−mH] / Σ_m w²[n−mH]. Es la proyección óptima cuando Mᵢ⊙χᵢ no es una STFT consistente.
- Para la UI se recomienda **COLA** con overlaps clásicos (Hann al 50 % o 75 %, Blackman-Harris al 75 %, etc.). Los presets de ventana ya vienen con hops válidos.

### 4.6 Para las operaciones no lineales (v2.1+)

Se elige una malla común (N\*, H\*, w\*), se **recalculan** las STFT desde el audio con esa malla (no se interpolan coeficientes) y se aplica la operación celda a celda.

### 4.7 Costo computacional y memoria

- **Render.** 30 s a 48 kHz con H = 256 son unos 5 600 frames. Con N = 4096, cada FFT cuesta unos N log₂N ≈ 49 000 operaciones. El render de una capa toma milisegundos a pocas centenas de ms en tu i9, así que **el render puede ser casi instantáneo** y rehacerse mientras editas (*live preview*).
- **Memoria.** Guardar χ completo sería 5 600 × 2 049 × 8 B ≈ 92 MB por canal y por capa, que es inaceptable. **No se guarda χ.** El render procesa *frame por frame* (STFT → máscara → IFFT → overlap-add) con memoria O(N). El espectrograma de la UI es aparte: magnitud en dB reducida a la resolución de pantalla (p. ej. 2048 × 512).

---

## 5. Arquitectura de software

### 5.1 Las piezas

```
┌──────────────────────────────── Fourierizer.vst3 ────────────────────────────────┐
│                                                                                  │
│  UI (WebView: TypeScript)            Bridge             Plugin (C++ / JUCE)      │
│  ┌─────────────────────────┐   eventos/funciones   ┌──────────────────────────┐  │
│  │ Spectrogram editor      │ ◄──────────────────► │ Project model (estado)   │  │
│  │ Layer strip (4 slots)   │                       │ Render worker (hilo)     │  │
│  │ Sampler / ADSR / keys   │                       │ Sampler (audio thread)   │  │
│  └─────────────────────────┘                       └────────────┬─────────────┘  │
│                                                                 │ usa            │
│                                              ┌──────────────────▼─────────────┐  │
│                                              │ fourierizer-core (C++ puro)    │  │
│                                              │ windows · STFT/ISTFT · masks · │  │
│                                              │ resampling · render graph      │  │
│                                              └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲ el mismo código de UI corre en el artifact (demo web)
        ▲ python/fourierizer_ref genera golden files para probar el core
```

### 5.2 Los tres hilos

*En simple:* el plugin hace tres trabajos a la vez, como tres personas en un estudio.

- El **"músico"** toca las notas. Nunca puede detenerse ni esperar a nadie: si se distrae un milisegundo, se oye un click.
- El **"técnico"** atiende la interfaz.
- El **"ingeniero de render"** calcula el sonido nuevo en un cuarto aparte. Cuando termina, le pasa la cinta al músico sin interrumpirlo.

*En técnico:*

- **Audio thread** (`processBlock`): real-time safe, es decir, sin asignación de memoria, sin locks y sin I/O. Solo corre el sampler.
- **Message thread:** UI, eventos y estado.
- **Render worker** (hilo propio): ejecuta el core. El resultado se entrega al audio thread con un **lock-free handoff** (swap atómico de un puntero a un buffer inmutable y reference counting diferido para liberarlo fuera del audio thread).

### 5.3 El sampler (lo que tocas)

Polifónico (16 voces, con robo de voz), ADSR, velocity→gain, root note autodetectada con YIN/pYIN sobre el resultado (editable), tune y fine, start offset, modo one-shot o loop con crossfade, y keytracking Tape con interpolación de alta calidad y mipmaps por octava. Un filtro simple (LP/HP) es opcional en la v2.0.

### 5.4 Modelo de proyecto (estado)

```jsonc
{
  "version": 1,
  "sampleRate": 48000,
  "slots": [
    { "source": { "name": "Lead Piano", "audioRef": "embedded:0", "channels": 2 },
      "analysis": { "window": "hann", "L": 2048, "N": 4096, "H": 512 },
      "transform": { "pitchSemitones": 0, "pitchCents": 0, "gainDb": 0, "offsetSec": 0.0 },
      "selection": [ { "type": "rect", "mode": "add", "t": [0.0, 3.8], "f": [120, 1050], "feather": 0.1, "gain": 1.0 },
                     { "type": "lasso", "mode": "subtract", "points": [[0.2, 300], [0.5, 900]], "feather": 0.05 } ] }
  ],
  "combine": { "op": "sum" },
  "sampler": { "rootNote": 60, "adsr": [0.005, 0.1, 1.0, 0.3], "mode": "tape", "voices": 16 },
  "history": [ /* DAG de renders e iteraciones */ ]
}
```

*En simple:* cuando guardas tu proyecto de FL, FL le pide al plugin "dame todo lo que necesitas para recordar cómo estabas" y lo mete dentro del `.flp`.

*En técnico:* `getStateInformation` / `setStateInformation` serializan este modelo con **audio embebido comprimido (FLAC)**, de modo que el proyecto es portable a otra computadora. El peor caso, 4 × 60 s estéreo, ronda las decenas de MB. Opción: referenciar rutas en vez de embeber.

### 5.5 Stack tecnológico

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje del plugin | C++20 | Estándar de la industria y control total del tiempo real |
| Framework | **JUCE 8** | Abstrae VST3, AU y standalone; WebView UI; la referencia de la industria |
| Build | **CMake** + Ninja; MSVC (Visual Studio 2022 Build Tools) en Windows | Estándar multiplataforma |
| FFT | **pocketfft** (header-only, BSD) | Cualquier N (no solo potencias de 2), precisión doble; es la misma base que usa numpy |
| Resampleo | **r8brain-free** (MIT) | Alta calidad, usado en productos profesionales |
| Tests C++ | **Catch2 v3** | Simple y popular |
| Validación del plugin | **pluginval** (Tracktion) y el validador de VST3 de Steinberg | Lo que corre cualquier estudio serio antes de publicar |
| UI | **TypeScript + Vite**, render del espectrograma en **WebGL2**; framework ligero (Svelte o Preact, se decide en un ADR) | Rápido de iterar y compartido con el demo |
| Referencia | Python ≥ 3.11, numpy, scipy, soundfile, pytest | Laboratorio y oráculo |
| CI | **GitHub Actions** (Windows + macOS) | Compila Mac sin tener Mac |
| Documento teórico | LaTeX (como la tesis), compilado en CI a PDF | Rigor tipográfico matemático |

**ADRs** (*Architecture Decision Records*): cada decisión importante queda escrita en `docs/adr/` con contexto, opciones, decisión y consecuencias. Es práctica estándar y material de aprendizaje para ti. Primeros ADRs:

- 001 C++/JUCE
- 002 WebView UI
- 003 suma por capa en el tiempo (sin remuestrear matrices)
- 004 máscaras vectoriales en unidades físicas
- 005 render offline + sampler en tiempo real
- 006 Python como referencia
- 007 licencia

---

## 6. Estructura del repositorio

```
fourierizer/
├── README.md                 ← qué es, enlace a v1 y a la tesis, cómo compilar
├── LICENSE
├── CMakeLists.txt            ← build raíz
├── cmake/                    ← dependencias (CPM) y opciones
├── core/                     ← fourierizer-core: DSP puro, sin JUCE
│   ├── include/fourierizer/  ← windows.h, stft.h, mask.h, render.h …
│   ├── src/
│   └── tests/                ← Catch2 + golden files
├── plugin/                   ← JUCE: Processor, Sampler, RenderWorker, Bridge, State
├── ui/                       ← TypeScript: la interfaz (plugin y demo)
├── demo/                     ← empaquetado del demo para el artifact (UI + motor web)
├── python/
│   ├── fourierizer_ref/      ← implementación de referencia
│   ├── golden/               ← generación de vectores de prueba
│   └── tests/
├── docs/
│   ├── plan/                 ← este plan
│   ├── adr/
│   ├── learning/             ← plugins 101, glosario, bitácora por hito
│   ├── design/               ← brief, tokens, rondas de feedback
│   └── theory/               ← documento teórico (LaTeX)
├── v1/                       ← versión de tesis (notebook; PDF y sonidos locales)
└── .github/workflows/        ← CI: build, tests, pluginval, PDF teórico
```

---

## 7. Hoja de ruta

Tamaño relativo: S / M / L. Cada hito cierra con: demo o entregable, nota en `docs/learning/bitacora/` (qué aprendimos, en pares simple/técnico) y actualización de este plan.

| Hito | Objetivo | Entregables | Validación | Tamaño |
|---|---|---|---|---|
| **H0 · Fundaciones** | Tener la "fábrica" funcionando de punta a punta | README, estructura, toolchain instalado, plugin *hola mundo* (un seno que suena con MIDI) que **carga en FL Studio**, CI Win+Mac, pluginval. **Spikes:** WebView dentro de FL; sidechain a un instrumento en FL | Tocas el seno en FL; CI verde; pluginval pasa | M |
| **H1 · Brief de diseño** (en paralelo a H0) | Entender tu gusto antes de diseñar | Cuestionario interactivo (artifact), moodboard de principios, **sistema de diseño v0** (tokens, knobs, tipografía) | Lo apruebas con la plantilla de feedback | S |
| **H2 · Referencia Python + teoría I** | La matemática correcta, ejecutable | `fourierizer_ref` (ventanas, STFT/ISTFT con NOLA, máscaras vectoriales, render por capas), golden files, re-creación de los 8 ejemplos de la tesis con el motor nuevo. Documento teórico: caps. 2–5 en borrador | Tests: reconstrucción perfecta sin máscara (error < 1e−6); A/B auditivo contra la v1 | M |
| **H3 · Demo web v0** | Feedback temprano de UX con audio real | Artifact: carga de 2–4 sonidos, espectrogramas, rectángulos/lazo/borrador, render y tocar con el teclado de la computadora (o WebMIDI si el navegador lo permite) | Ronda de feedback #1 | M |
| **H4 · Core C++** | El motor del plugin | `fourierizer-core`: ventanas, STFT/ISTFT, rasterización de máscaras, render por capas, resampleo de importación | Iguala los golden files de Python; benchmarks de render | M |
| **H5 · Plugin MVP = v2.0** | **Definición de terminado** | UI web dentro del plugin, drag & drop de archivos, render en worker, sampler polifónico con ADSR y root note, estado guardado en el `.flp`, export WAV / drag al playlist | **Haces un beat con un sonido fourierizado** | L |
| **H6 · Modo Spectral** | Tocar sin cambiar la duración | Switch Tape/Spectral funcional: pitch shift espectral (phase vocoder con phase locking) con render por nota cacheado | Comparación A/B Tape vs Spectral | M |
| **H7 · Capas pro** | Control fino | Pitch y offset por capa, iteraciones ("→ Slot" + historial), presets | Ronda de feedback #2 | M |
| **H8 · Selección avanzada + multirresolución + captura** | Versatilidad | Pincel, armónica (f₀·k), varita, booleanas; multirresolución por bandas; plugin compañero **Fourierizer Capture** + navegador de capturas | Ronda de feedback #3 | L |
| **H9 · Operaciones v2.1** (si decides) | Nuevas síntesis | Cross-synthesis, máximo espectral, etc. Se prueban primero en el demo web (puede adelantarse desde H3); en C++ solo las que te convenzan | Tu veredicto auditivo | M |
| **H10 · Release 2.0** | Que tus amigos lo usen | Instaladores Win/Mac, licencia decidida, firma (según §3.8), página de descarga, manual de usuario, **documento teórico final en PDF (español) + traducción al inglés** | Un amigo con Mac y uno con Windows lo instalan solos | M |
| **H11 · Fábrica de plugins** | Reutilizar todo esto | Repo plantilla aparte + **skills de Claude** (§12) | Crear un plugin nuevo "vacío" desde la plantilla en minutos | M |

**Orden.** H0 y H1 en paralelo → H2 → H3 (el demo puede adelantarse a H4) → H4 → **H5 (v2.0)** → H6 (Spectral) → H7 a H11 según prioridades.

---

## 8. Documento teórico: *Fourierizer — Fundamentos matemáticos de la síntesis por selección tiempo-frecuencia*

Es la evolución de la tesis. Cada capítulo tiene recuadros **"En el estudio"** que traducen el resultado a decisiones sonoras concretas.

1. **Sonido, señal y percepción.** Condensado de la tesis, más psicoacústica: percepción logarítmica de la altura, bandas críticas (Bark/ERB), loudness, enmascaramiento. Por qué el eje de frecuencia es logarítmico.
2. **Fourier en tiempo discreto.** DFT como cambio de base en ℂᴺ; propiedades (linealidad, desplazamiento, teorema de convolución, Parseval); periodicidad implícita; aliasing y el teorema de muestreo con más cuidado; zero-padding (interpolación espectral, **no** más resolución).
3. **Ventanas.** Leakage; lóbulo principal vs lóbulos laterales; métricas (ancho a −3 dB, nivel de sidelobe, roll-off, ENBW, scalloping loss); familia de cosenos generalizados; Kaiser y la aproximación a las funciones esferoidales prolatas; la gaussiana como óptimo. En el estudio: qué ventana para kicks, pads o voces.
4. **STFT como marco de Gabor.** Redundancia; análisis y síntesis; ventana dual; COLA y NOLA; ISTFT como proyección de mínimos cuadrados (Griffin–Lim); consistencia de STFT; principio de incertidumbre (Δt·Δf ≥ 1/4π) y por qué no se puede tener todo.
5. **Máscaras tiempo-frecuencia.** Máscaras binarias vs suaves; artefactos (*musical noise*, ringing, pre-eco) explicados con la proyección del cap. 4; feathering; geometría en el plano (t, log f) y rasterización.
6. **Multirresolución.** Bancos de filtros con reconstrucción perfecta; NSGT y CQT invertible; ventajas sonoras.
7. **Transformaciones.** Resampleo de banda limitada (interpolación sinc, filtros polifásicos); pitch y tiempo acoplados (Tape); phase vocoder, desacoplamiento, phasiness, phase locking (Laroche–Dolson); transientes.
8. **Operaciones entre espectros.** Suma, cross-synthesis, vocoder, morph, máximo y resta espectral: definiciones, propiedades y lo que se oye.
9. **Del sonido al instrumento.** Sampler, keytracking, mipmaps y aliasing, envolventes ADSR, polifonía; restricciones de tiempo real y latencia (tasa de bloque, deadline).
10. **Fourierizer.** El algoritmo completo (pseudocódigo nuevo), su complejidad y los 8 ejemplos de la tesis rehechos, con comparación de espectrogramas v1 vs v2.

Apéndices: notación, demostraciones selectas, tabla de ventanas, glosario matemático-musical.

---

## 9. Proceso de diseño de interfaz

**Principios iniciales** (para validar en el cuestionario):

- **Original,** inspirado en *principios* de Teenage Engineering, sin copiar marca, tipografías ni el look exacto de un producto: minimalismo funcional, retícula estricta, objetos que parecen hardware, etiquetas pequeñas y precisas.
- **Fondo claro,** colores **planos** sin degradados, mucho contraste. Lo contrario de Serum.
- **Idea central:** 4 capas = 4 colores de identidad, como los cuatro encoders de color de un sintetizador de bolsillo. Cada capa tiene su color en todo: su slot, su espectrograma, su selección, sus knobs. Paleta: naranja (tipo Claude), verde (tipo Celtics), azul (tipo Panthers) y **morado/fucsia** (el tono exacto se elige en el cuestionario).
- **Pantalla protagonista:** el espectrograma como "display" del instrumento.

**Plantilla de feedback** (en cada ronda): ✅ qué funciona · ❌ qué no · ➕ qué falta · ⭐ prioridad (alta/media/baja).

---

## 10. Ruta de aprendizaje

- [docs/learning/01-plugins-101.md](../learning/01-plugins-101.md): conceptos base en pares simple/técnico (ya escrito).
- `docs/learning/bitacora/`: una nota por hito ("qué construimos, qué conceptos aparecieron, qué estándar de la industria seguimos").
- Glosario acumulativo al final de 01-plugins-101.
- Al cerrar cada hito, un **recorrido guiado** por el código: qué hace cada archivo a grandes rasgos y las particularidades de C++ que aparecieron (punteros, RAII, hilos, atómicos), sin pedirte que programes.

---

## 11. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| WebView dentro de FL (WebView2, foco de teclado, escalado DPI) | UI inestable | ✅ Spike H0: carga y controla parámetros en FL 2026. Quedan por vigilar el foco de teclado y el DPI |
| FL no enruta el sidechain a instrumentos | No hay captura directa | ⚠️ Confirmado en el spike H0 → plugin compañero Capture (§3.2) |
| El instalador no coloca el VST3 donde FL lo busca | "No aparece el plugin" | FL registró la carpeta VST3 por usuario como ruta VST2. El instalador del release copia a `C:\Program Files\Common Files\VST3` |
| Artefactos de máscaras duras | Sonido sucio | Feather por defecto; teoría cap. 5 |
| Calidad del pitch shift (Tape en notas lejanas, Spectral en transientes) | Instrumento poco usable | Mipmaps; render offline de alta calidad; A/B |
| Violaciones de tiempo real (clicks) | Inaceptable en producción | Reglas de audio thread, handoff lock-free, pluginval, tests de estrés |
| Tamaño del estado (audio embebido) | `.flp` pesado | FLAC, límite de 60 s, opción de referenciar archivos |
| Mac sin Mac | Bugs no vistos | CI macOS, amigos como testers, logs |
| Alcance que crece | Nunca termina | H5 es sagrado: nada de H6+ entra antes de la v2.0 |

---

## 12. Fábrica de plugins y skills de Claude

Durante el proyecto se registran **tus preferencias de desarrollo** (estructura, estilo de UI, flujo de feedback, formato de explicaciones) en `docs/learning/preferencias.md`. En H11 se extraen:

- **Repo plantilla** (p. ej. `plugin-factory`): CMake + JUCE + WebView UI + CI + pluginval + sistema de diseño + estructura de docs/ADRs.
- **Skills de Claude**, por ejemplo:
  - "nuevo plugin desde plantilla";
  - "revisión de seguridad de tiempo real";
  - "ronda de feedback de diseño";
  - "explicación en pares simple/técnico";
  - "checklist de release VST3".

---

## 13. Decisiones abiertas (te toca)

1. **Licencia** del código (open source o cerrado). Se puede decidir hasta H10, pero condiciona cómo se usa JUCE.
2. **¿Qué operaciones además de la suma entran?** Se decide después de probarlas en el demo web (D9).

*Resueltas el 2026-11-12:* idioma del documento teórico (D16), sonidos de prueba (D18), cuarto color (D19), switch Tape/Spectral (D2).
