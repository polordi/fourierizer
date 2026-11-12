# Plugins 101

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** como lo diría alguien de la industria.

El término clave va en **negritas**. La idea es leer la versión simple, luego la técnica, y ver cómo la segunda "nombra" lo que la primera describe.

---

### 1. Plugin y host

**En simple:** un plugin es un programa que no se abre solo; vive *dentro* de otro programa. FL Studio es la casa; Serum, Vital o Fourierizer son inquilinos. FL les da audio y notas, y ellos devuelven sonido.

**En técnico:** un **plugin** es una biblioteca dinámica (en Windows, una DLL empaquetada como **bundle** `.vst3`) que el **host** (el DAW) carga en su propio proceso. El host llama a funciones del plugin definidas por un estándar (la **API** del formato).

### 2. Formatos: VST3, AU, AAX y CLAP

**En simple:** son "idiomas" para que el plugin y el DAW se entiendan. FL habla VST3, Logic habla AU y Pro Tools habla AAX. Hay que "traducir" el plugin a cada idioma.

**En técnico:** **VST3** (Steinberg) es el formato multiplataforma dominante. **AU** (Audio Units) es exclusivo de macOS y obligatorio para Logic. **AAX** es de Avid/Pro Tools y requiere acuerdo y firma con Avid. **CLAP** es un estándar abierto más reciente. Un **framework** como JUCE genera varios formatos desde el mismo código (**wrappers**).

### 3. Instrumento vs efecto

**En simple:** un instrumento recibe notas y produce sonido (va en el Channel Rack). Un efecto recibe sonido y lo transforma (va en el Mixer).

**En técnico:** la diferencia está en los **buses** que declara el plugin. Un **instrument** tiene entrada de **MIDI/eventos** y buses de salida de audio. Un **effect** tiene buses de entrada y de salida de audio. Un instrumento puede declarar además un **sidechain/aux input bus** para recibir audio, y así es como Fourierizer podrá grabar otros canales.

### 4. El buffer y el callback de audio

**En simple:** el DAW no le pide al plugin el sonido "de golpe", sino a pedacitos de unas cuantas milésimas de segundo, cientos de veces por segundo. Cada vez el plugin tiene que entregar su pedacito **a tiempo**. Si llega tarde, se oye un click o un corte.

**En técnico:** el host invoca el **audio callback** (`processBlock` en JUCE) con un **buffer** de *B* muestras (el **block size**, típicamente 64–1024). A F_s = 48 kHz y B = 512, el **deadline** es 512/48000 ≈ 10.7 ms. Si no se cumple, hay un **xrun / dropout**.

### 5. Tiempo real

**En simple:** dentro de ese pedacito de tiempo está prohibido hacer cosas que puedan "tardar quién sabe cuánto": pedir memoria nueva, esperar a otro proceso o leer archivos. Es como un músico en vivo: no puede pausar la canción para ir por otra partitura.

**En técnico:** el código del **audio thread** debe ser **real-time safe**: sin **heap allocation**, sin **locks/mutex** (riesgo de **priority inversion**), sin I/O de disco o red y sin llamadas al sistema que bloqueen. Para comunicar hilos se usan estructuras **lock-free** (atómicos, **ring buffers / FIFOs** de un solo productor y un solo consumidor).

### 6. Latencia

**En simple:** el tiempo entre que tocas una tecla y oyes el sonido. Si es grande, el instrumento se siente "chicloso".

**En técnico:** la **latencia** total = buffer del driver (ASIO) + **latencia reportada por el plugin** (`setLatencySamples`, para que el host la compense con **PDC**, *plugin delay compensation*). Fourierizer reproduce audio ya renderizado, así que no añade latencia algorítmica; la STFT ocurre fuera del tiempo real.

### 7. MIDI

**En simple:** MIDI no es sonido, son *instrucciones*: "tecla 60, con fuerza 100, empieza ahora", "suelta la tecla 60", "mueve la perilla 74 a 50".

**En técnico:** mensajes **Note On / Note Off** (nota 0–127, **velocity** 0–127), **CC** (*control change*), **pitch bend** y **aftertouch**. En VST3, los eventos de nota llegan al bloque con un **sample offset** (en qué muestra exacta del buffer ocurren), y los CC se traducen a parámetros (`IMidiMapping`).

### 8. Parámetros, automatización y estado

**En simple:**

- Las perillas que el plugin "publica" hacia FL son sus *parámetros*. FL puede moverlas solo (automatización) o conectarlas a tu controlador.
- El *estado* es todo lo que el plugin necesita para recordar cómo lo dejaste cuando guardas el proyecto, incluidos tus sonidos cargados.

**En técnico:**

- Los **host parameters** son valores normalizados en [0,1] con ID estable. En JUCE se gestionan con `AudioProcessorValueTreeState` (**APVTS**) y se mueven desde el audio thread de forma segura.
- El **state** se serializa a un **blob** binario en `getStateInformation` y se restaura en `setStateInformation`. El host lo guarda dentro del proyecto (`.flp`).
- Cambiar el ID de un parámetro entre versiones rompe los proyectos viejos. Por eso los IDs se diseñan desde el principio y nunca se cambian.

### 9. Hilos

**En simple:** el plugin hace varias cosas a la vez, cada una con su propio "trabajador": uno solo toca (el sonido), otro atiende la interfaz y otro hace cálculos pesados (como renderizar el sonido fourierizado).

**En técnico:**

- El **audio thread** es de alta prioridad y lo controla el host.
- El **message thread** (o *UI thread*) es el loop de eventos de la interfaz.
- Los **worker / background threads** hacen trabajo pesado.

La regla de oro: el audio thread **nunca espera** a los otros. Se comunican con **atomics** o **lock-free queues**, y los objetos grandes se entregan por **pointer swap**.

### 10. Sampler, voces y envolventes

**En simple:**

- Un sampler toca un sonido grabado y lo ajusta a la tecla que presionas.
- Cada tecla sonando al mismo tiempo es una "voz". Si tocas un acorde de 4 notas, hay 4 voces.
- La envolvente ADSR controla cómo entra y sale cada nota.

**En técnico:**

- Un **voice engine** (`Synthesiser` + `SynthesiserVoice` en JUCE, o uno propio) con **polyphony** N y **voice stealing** (qué voz se reutiliza cuando se acaban).
- **Keytracking** por **resampling**, con interpolación (cúbica o **windowed sinc / polyphase**) y **mipmaps** para evitar aliasing.
- **ADSR** por voz; **root note** = nota MIDI en la que el sample suena sin transponer.

### 11. El editor (la interfaz)

**En simple:** la ventana que ves al abrir el plugin. Puede dibujarse "a mano" con las herramientas de JUCE o puede ser una pequeña página web que vive dentro del plugin.

**En técnico:** el **editor** (`AudioProcessorEditor`) es independiente del **processor**: el host puede cerrarlo y el audio sigue sonando. Hay dos opciones:

- **UI nativa:** componentes de JUCE dibujados con su API gráfica.
- **WebView UI:** un navegador embebido (**WebView2** en Windows, **WKWebView** en macOS) que carga HTML/CSS/JS y se comunica con C++ por un **bridge** (funciones nativas y eventos).

### 12. Compilar

**En simple:** el código que escribo es texto para humanos. La computadora necesita un archivo traducido a su "idioma de máquina". Compilar es esa traducción, y hay que hacerla por separado para Windows y para Mac.

**En técnico:**

- El **compilador** (MSVC en Windows, Clang en macOS) produce **binarios** por **arquitectura**: x64 en Windows; en Mac, **universal binary** arm64 + x86_64.
- **CMake** es el **build system generator**: describe el proyecto una vez y genera proyectos de Visual Studio, Ninja o Xcode.
- Las dependencias externas (JUCE, pocketfft…) se descargan con **CPM** o como **git submodules**.

### 13. Dónde vive el plugin y cómo lo encuentra FL

**En simple:** hay una carpeta "oficial" donde se ponen los plugins. FL la revisa (el *scan*) y los agrega a su lista.

**En técnico:** la ruta estándar de VST3 en Windows es `C:\Program Files\Common Files\VST3\` y en macOS `/Library/Audio/Plug-Ins/VST3/`. El host hace un **plugin scan** (en FL, desde el *Plugin Manager*), lee los metadatos (nombre, fabricante, **plugin ID** único, categoría *Instrument*) y lo cachea.

### 14. Validación y CI

**En simple:**

- Antes de darle un plugin a alguien, se pasa por un "examen" automático que lo carga, lo estresa y revisa que no truene ni haga cosas prohibidas.
- Además, cada vez que cambio código, un servidor en la nube lo compila y lo examina solo.

**En técnico:**

- **pluginval** (de Tracktion) y el **VST3 validator** de Steinberg prueban carga y descarga, cambios de sample rate y block size, estado y parámetros, y seguridad de hilos.
- **CI** (*continuous integration*) con **GitHub Actions** compila en **runners** Windows y macOS, corre los **unit tests** y pluginval en cada **push** o **pull request**.

### 15. Distribución

**En simple:**

- Para que otros lo instalen, se arma un instalador.
- Windows y Mac desconfían de programas sin "firma" del autor. Mac es especialmente estricto.

**En técnico:**

- **Installer** (Inno Setup en Windows, `.pkg` en macOS).
- **Code signing** con certificado en Windows (evita advertencias de SmartScreen).
- En macOS, **firma con Developer ID + notarization** (Apple escanea el binario). Sin eso, **Gatekeeper** bloquea el plugin.

### 16. Framework: JUCE

**En simple:** escribir un plugin "desde cero" para cada idioma y cada sistema operativo sería enorme. JUCE es una caja de herramientas que ya resuelve todo eso; tú solo escribes lo que hace especial a tu plugin.

**En técnico:** **JUCE** es un framework C++ que provee **plugin wrappers** (VST3, AU, AAX, Standalone), **DSP module**, GUI (nativa y WebView), audio I/O, MIDI y utilidades de hilos. El plugin se define como una subclase de `AudioProcessor` (motor) y de `AudioProcessorEditor` (UI). Es el estándar de facto en la industria de plugins comerciales.

---

## Glosario acumulativo

| Término | Significado corto |
|---|---|
| **APVTS** | Gestor de parámetros y estado de JUCE |
| **Audio thread** | Hilo de tiempo real donde corre `processBlock` |
| **Block size** | Número de muestras por llamada al callback |
| **Bridge** | Canal de comunicación UI web ↔ C++ |
| **Bus** | Conjunto de canales de entrada o salida que declara un plugin |
| **CI** | Compilación y pruebas automáticas en la nube |
| **Deadline** | Tiempo máximo para entregar un buffer |
| **Host** | El programa que carga plugins (el DAW) |
| **Keytracking** | Transponer el sample según la tecla |
| **Lock-free** | Comunicación entre hilos sin bloquear |
| **Mipmap** | Versiones prefiltradas de un sample para transponer sin aliasing |
| **PDC** | Compensación de latencia del host |
| **pluginval** | Validador automático de plugins |
| **Real-time safe** | Código que garantiza terminar a tiempo |
| **Root note** | Nota en la que el sample suena sin transponer |
| **Sidechain** | Entrada de audio auxiliar de un plugin |
| **Spike** | Experimento corto para reducir un riesgo técnico |
| **State** | Blob que el plugin guarda dentro del proyecto |
| **Voice stealing** | Reutilizar una voz cuando se acaba la polifonía |
| **WebView** | Navegador embebido que dibuja la UI |
| **xrun / dropout** | Corte audible por no cumplir el deadline |
