# H6 · Modo Spectral: bitácora

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

## Qué construimos

El switch **Tape / Spectral** del módulo Sampler ya funciona.

- **Tape** es como antes: cada nota acelera o frena el sonido, y una octava arriba dura la mitad.
- **Spectral** cambia la nota sin cambiar la duración: un pad de 20 s dura 20 s en cualquier tecla.

Con Spectral activo aparece debajo del switch una elección de ventana:

| Opción | Ventana a 48 kHz | Para qué |
|---|---|---|
| **Tonal** (por defecto) | 4096 (85 ms) | Pads, acordes, texturas: lo más suave |
| **Mixed** | 2048 (43 ms) | Un punto medio |
| **Punchy** | 1024 (21 ms) | Ataques y percusión: menos "lavado", pero los graves pierden definición |

Una barra fina dentro de la tecla *Spectral* se llena mientras se preparan las notas de la octava alrededor del root. Mode y Window son **parámetros del plugin**: FL los guarda en el proyecto y se pueden ligar al MPK o automatizar.

## Cómo funciona el pitch shift

| Paso | En simple | En técnico |
|---|---|---|
| 1. Estirar | Se alarga el sonido r veces (r = 2^(semitonos/12)) **sin cambiar su tono**, repitiendo "fotos" del espectro más espaciadas. | *Phase vocoder*: marcos de síntesis cada H = N/8 muestras, el marco j analiza la entrada centrada en round(j·H/r). |
| 2. Fases coherentes | Cada frecuencia tiene que "seguir girando" al ritmo correcto entre fotos, o el sonido se oye metálico. | La frecuencia instantánea de cada bin se mide con un segundo marco δ = N/8 muestras antes: ω = 2πk/N + princarg(Δφ − 2πkδ/N)/δ. La fase de síntesis avanza ω·H por marco. Como se mide aparte, funciona con cualquier salto de análisis. |
| 3. Phase locking | Los bins alrededor de un pico se mueven juntos, como un bloque, en vez de cada uno por su lado. | *Identity phase locking* (Laroche y Dolson, 1999): solo los picos (máximos locales en ±2 bins) propagan su fase; cada bin gira el mismo ángulo θ que su pico más cercano. |
| 4. Estéreo | Izquierda y derecha giran exactamente igual, así la imagen estéreo no se deshace. | Las fases se calculan una vez sobre la señal *mid* (L+R) y la misma rotación e^{iθ_k} se aplica a cada canal. |
| 5. Remuestrear | El sonido estirado se lee r veces más rápido: vuelve a durar lo mismo y todas las frecuencias quedan multiplicadas por r. | El mismo resampler sinc-Kaiser de Tape (filtrado a la nueva Nyquist cuando r > 1). |

**Por qué los ataques sufren**
- *En simple:* un golpe que cae dentro de una "foto" se reparte en toda la foto, así que suena un poquito antes y más suave. Con fotos más cortas (Punchy) el efecto casi desaparece.
- *En técnico:* pre-eco del orden de la longitud de ventana. Medido en un tren de clicks a +7 st: −21 dB con N = 4096, −28 dB con 2048, −39 dB con 1024. Probé además un *phase reset* en transitorios (máximo local del flujo espectral): no cambiaba casi nada (pico 0.57 vs 0.58), así que lo quité y la decisión quedó en manos de la ventana.

## Cómo está armado en el plugin

| Pieza | En simple | En técnico |
|---|---|---|
| [spectral (core)](../../../core/src/spectral.cpp) | El algoritmo en C++. Puede entregar el resultado "por pedazos", así una nota empieza a sonar antes de estar completa. | `fz::SpectralShifter`: produce la salida en *chunks* con una ventana deslizante del estirado; la salida es idéntica (bit a bit) se calcule de golpe o por pedazos. |
| [SpectralBank](../../../plugin/source/SpectralBank.cpp) | Un estante con una copia del resultado por cada semitono. Dos ayudantes en segundo plano las llenan: primero las notas que tocaste, luego la octava alrededor del root. | Ranuras de ±48 st con `SampleBuffer::ready` (muestras ya finales). 2 hilos de trabajo, prioridad: pedidas (FIFO sin locks desde el hilo de audio) > adelantadas (±12, por distancia al root). Presupuesto de 1 GB con desalojo LRU; un nuevo resultado o ventana invalida todo. |
| [Sampler](../../../plugin/source/Sampler.cpp) | En Spectral, cada nota toca su copia a velocidad normal. Si la copia aún se está calculando, la nota espera solo lo que falta. | La voz lee la copia de su semitono con paso 48000/fs del host. Si `pos + 3 > ready`, se detiene hasta el siguiente bloque. En **render offline** (exportar en FL, `isNonRealtime()`) sí espera, para que el bounce no dependa del CPU. |

**La primera vez que tocas una nota lejana**
- *En simple:* si la nota no estaba preparada, tarda unos 10 ms en empezar (un bloque de audio). Después ya está guardada y sale al instante.
- *En técnico:* el primer *chunk* es de 4096 muestras (≈ 6–14 ms de cómputo) y los siguientes de 16384. Una copia se calcula a 8–40× tiempo real según el intervalo, así que la reproducción nunca alcanza al cálculo. Medido en la prueba del sampler: inicio a 10.7 ms, cero cortes.

## Pruebas (2026-11-14)

- ✅ Python: el tono es exacto (440 Hz → 880.0 a +12, 659.26 a +7), la duración es idéntica y el nivel RMS se conserva (±2 %) en las tres ventanas. Con 0 st la salida es igual a la entrada.
- ✅ Golden files: TypeScript y C++ coinciden con Python con error de 4e-10 a 7e-10. La tolerancia aquí es 1e-7 y no 1e-9: las fases viajan de marco en marco, también por bins casi en silencio cuya fase tiene mucho error relativo. Cuando esos bins suben de volumen (la ráfaga de ruido del caso de prueba), ese error escala con el nivel. En C++, la salida por pedazos es idéntica a la completa.
- ✅ [SamplerTest](../../../plugin/tests/SamplerTest.cpp), sin host: Tape a +12 da 440 Hz y termina a 1 s; Spectral da 440 Hz y dura los 2 s completos. Offline arranca a 0 ms; en tiempo real arranca a 10.7 ms sin cortes. Corre también en la CI.
- ✅ Demo y Standalone con puppeteer: con Spectral el cabezal avanza a la misma velocidad que en el root (en Tape, al doble a +12). Las 24 notas tardan 4.5 s en estar listas en el plugin y 9.7 s en el navegador para un resultado de 4 s. Cambiar la ventana recalcula todo.
- ✅ Guardar y reabrir: Mode, Window y la envolvente vuelven tal como estaban.
- ✅ pluginval nivel 8: SUCCESS.

**Bug arreglado de paso:** al abrir la ventana del plugin, la interfaz mandaba sus valores por defecto (ADSR, Root) antes de leer los del proyecto, así que podía resetearlos. Ahora, dentro del plugin, la interfaz no manda nada hasta leer el proyecto.

## Cómo probarlo en FL Studio

1. Vuelve a escanear plugins o reinicia FL (el VST3 ya está actualizado en la misma carpeta).
2. Renderiza algo largo (un pad o una textura) y cambia a **Spectral**. Espera a que se llene la barra.
3. Toca acordes en distintas octavas. Compara con **Tape** en las mismas teclas.
4. Prueba **Tonal** contra **Punchy** con algo percusivo.
5. Exporta un loop con notas lejanas al root (por ejemplo ±2 octavas) y revisa que suenen a tiempo.

Plantilla de feedback: ✅ qué funciona · ❌ qué no · ➕ qué falta · ⭐ prioridad.

## Ronda de feedback (2026-11-14): un piano en el eje

"Tonal y Punchy están padrísimos". Lo único que faltaba: un piano en el eje vertical de cada espectrograma como referencia de notas.

| Qué | En simple | En técnico |
|---|---|---|
| Piano en cada eje | Junto a las frecuencias de cada capa y del resultado hay un teclado: graves abajo, una raya en cada Do y la tecla del Root en azul. | [piano.ts](../../../ui/src/view/piano.ts) dibuja en un canvas cada semitono entre f(n ± ½) con el mismo `freqToY` del espectrograma, así que sigue la escala Log/Lin y el rango Low/High. |
| Se adapta al tamaño | En vistas chicas las teclas no caben (≈ 1 px por semitono), así que solo quedan las rayas de octava y el Root; al ampliar o hacer zoom aparece el teclado completo. | *Level of detail*: la opacidad de teclas negras y separadores es clamp((h − 1.5)/3, 0, 1), donde h es la altura del semitono en píxeles. El Root se dibuja al final, con al menos 2 px. |
| La nota bajo el cursor | En la capa ampliada, la lectura del cursor dice también la nota y cuánto se desvía: "775 Hz · G5 −21¢". | n = 69 + 12·log₂(f/440), redondeado, con la desviación en cents. |
| Etiquetas Hz / Notes | En *Display* puedes cambiar las etiquetas del eje de Hz a octavas (C1, C2, …). Se guarda en el proyecto. | `Display.labels`; en escala lineal se omiten las etiquetas que se encimarían (separación mínima del 6 % de la altura). |
