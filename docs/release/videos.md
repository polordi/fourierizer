# Videos de lanzamiento: guion (borrador 3)

**Decisiones del autor (2026-11-15, borrador 3):**

- **Frases:** el trailer usa las tres, en este orden:
  - la **2** como apertura: qué hace;
  - la **1** a la mitad, después de las primeras transformaciones: la promesa;
  - la **3** antes del cierre: qué es.

  La story usa la **1** como gancho y la **3** al final.
- **Fuentes:** samples de uso libre de la biblioteca del autor (Cymatics, Dreamscapes, Ethereal Soundscapes). Nunca se suben al repositorio.
- **Sin pieza final.** El cierre es una frase tocada con uno o dos de los sonidos resultantes (teclado de la app y cabezal en pantalla).
- **El enlace** se agrega después.
- **Primer paso:** renderizar las transformaciones como audio, para que el autor escuche y elija, antes de grabar pantalla. Están en `D:\Samples Polo\Fourierizer\Video previews` (fuentes `*-src-*` y resultados).


**Cambios respecto al borrador 1** (notas del autor, 2026-11-15):

- **El gancho** ya no es "convierte cualquier sonido en un instrumento". Es lo que hace único a Fourierizer: sonidos nuevos, que difícilmente se conseguirían de otra forma, hechos al recortar y mezclar sonidos que ya existen.
- **Solo la pantalla del sintetizador.** No hay tomas de manos ni de instrumentos; cuando algo se toca, se ve en la interfaz (teclas, cabezal, espectrograma).
- **La música** está hecha solo con los sonidos que el video crea en pantalla, para que el soundtrack sea en sí la demostración.
- **Inglés, sin voz.** Solo subtítulos.

Siguen dos piezas:

1. **Trailer** horizontal (16:9, 1920 × 1080, 60 fps), unos 2:30.
2. **Story** vertical (9:16, 1080 × 1920), 30 s.

**Estilo:** el de la app. Chasis claro, tinta, los cuatro colores de capa como único acento, Archivo para los títulos e IBM Plex Mono para los subtítulos y datos; cortes secos.

## El gancho (opciones)

1. **"Sounds that don't exist yet are hiding inside the ones you already have."**
2. **"Cut sounds apart in time and frequency. Rebuild them into something new."**
3. **"Not a filter. Not a sampler. A way to make sounds you can't get any other way."**

Recomiendo la 1 para abrir el trailer y la 3, más corta, para la story.

## La idea central: transformaciones "A → nuevo"

Cada bloque del video es una **transformación**. Se ve y se oye la fuente (o las fuentes), cómo se selecciona y el sonido nuevo que sale. Un subtítulo de una línea dice el truco. Las candidatas:

| # | Fuentes | Lo que se hace | Subtítulo |
|---|---|---|---|
| T1 | Lluvia | Tres peines armónicos sobre el ruido de la lluvia, en las notas de un acorde | *Rain, tuned to a chord.* |
| T2 | Voz cantada | Peine en *Odd*: solo los armónicos impares | *A voice made hollow: only its odd harmonics.* |
| T3 | Piano + break de batería | *Cross*: el cuerpo del piano con el movimiento del break | *A piano that moves like a drum break.* |
| T4 | Platillo + campana | Solo el ataque del platillo (rectángulo corto) sobre la cola de la campana (lazo) | *The attack of one sound, the tail of another.* |
| T5 | Un resultado anterior | *Send to layer* y una selección sobre él (la toma muestra su linaje) | *Then select from what you made.* |
| T6 | Un sonido grabado del mixer | Capture con START ON SIGNAL y la varita sobre lo grabado | *Record anything from your mixer.* |

Se eligen las 4–5 que mejor suenen una vez hechas.

## 1. Trailer (≈ 2:30)

| Tiempo | Imagen | Audio | Subtítulo |
|---|---|---|---|
| 0:00–0:10 | Negro. Un espectrograma se dibuja con el cabezal; zoom lento. | El sonido nuevo más llamativo (por ejemplo T1). | Gancho 1 |
| 0:10–0:16 | Zoom out a la interfaz completa. Logotipo. | Corte seco. | **FOURIERIZER** · *Time–frequency selection synth* |
| 0:16–0:28 | Cuatro sonidos cayendo en las capas; aparecen sus espectrogramas. | Cada fuente, un instante. | *Every sound is an image of time and frequency.* |
| 0:28–1:40 | **Transformaciones T1–T4**, unos 18 s cada una: fuente → herramienta → resultado. Cada una cierra con el espectrograma del resultado en el módulo Result. | Fuente sola → resultado. | El de cada transformación |
| 1:40–1:55 | **Tocar**: el teclado de la app y el cabezal sobre el resultado; cambio de Tape a Spectral. | Una frase tocada con el sonido de T1 o T3. | *Every result is an instrument.* |
| 1:55–2:08 | **T5** (iterar) y vista Takes. | La segunda generación. | *Then select from what you made.* |
| 2:08–2:15 | **T6**, la ventana de Capture. | — | *Record anything from your mixer.* |
| 2:15–2:30 | **La pieza**: la música hecha solo con los sonidos anteriores, con cortes al ritmo entre los espectrogramas que la forman. Cierre en el logotipo. | La pieza. | **FOURIERIZER** · *Free and open source · Windows & macOS · VST3 + app* · enlace |

## 2. Story (30 s)

| Tiempo | Imagen (vertical: recortes y acercamientos de la interfaz) | Audio | Subtítulo |
|---|---|---|---|
| 0–3 s | Espectrograma muy cerca, dibujándose. | El sonido de T1. | Gancho 3 |
| 3–10 s | T1: la lluvia → los peines → la lluvia afinada. | Fuente → resultado. | *Rain, tuned to a chord.* |
| 10–17 s | T3: piano + break → Cross. | Fuente → resultado. | *A piano that moves like a drum break.* |
| 17–26 s | La pieza, con cortes al ritmo. | La pieza. | — |
| 26–30 s | Logotipo sobre el chasis. | Final. | **FOURIERIZER** · *Free · link in bio* |

## Producción

- **Pantalla:** la app real, grabada por un guion automático (puppeteer) que hace cada gesto con tiempos exactos; se añade un cursor dibujado. Se puede repetir hasta que quede perfecto.
- **Audio:** sale del mismo motor del plugin, renderizado, no grabado de la tarjeta de sonido, así que queda sincronizado al cuadro con la imagen. Las fuentes y los resultados son reales.
- **La pieza final:** está hecha con los sonidos del video (ver la pregunta 2).
- **Edición:** ffmpeg, a partir de un guion de tiempos; títulos con las tipografías de la app; el formato vertical se arma con recortes de la interfaz.

## Lo que falta decidir

1. **Las fuentes.** Hacen falta 6–8 sonidos reales (lluvia, voz cantada, piano, break, platillo, campana…) que se puedan mostrar en un video público. Pueden ser grabaciones tuyas o muestras libres de derechos de tu biblioteca. Si no tienes alguna, puedo buscar opciones en dominio público (CC0) para que las apruebes.
2. **La pieza final.** O la produces tú con los sonidos que te exporto de cada transformación (es lo que más te representa), o la arreglo yo a partir de esos sonidos, con secuencias renderizadas por el motor del plugin, y tú la apruebas.
3. **El gancho:** 1, 2, 3 u otro.
4. **El enlace del final.**

## Primer corte (2026-11-16)

Los dos borradores están en `D:\Samples Polo\Fourierizer\Video drafts`. Las escenas se graban con `build/tools/video` (fuera del repo): `scene-t1.cjs`, `scenes.cjs`, `cards.cjs` y `story.cjs`; `assemble.cjs` las une.

**Trailer** (3:01, 1920 × 1080, 60 fps):

1. Frase 2 en negro, sobre la lluvia afinada.
2. Logotipo.
3. Cuatro sonidos caen en las capas: *Every sound is an image of time and frequency.*
4. T1 lluvia en La menor y T2 pad hueco (armónicos impares).
5. Frase 1.
6. T3 *Cross* (piano × break), T4 *Product* (voz × lluvia), T5 ataque de platillo + cola de campana, T6 *Max* (break × olas).
7. El pad hueco tocado en acordes: *Every result is an instrument.*
8. Frase 3 y cierre con el logotipo.

**Story** (0:34, 1080 × 1920): frase 1 → T1 → T3 → acordes → frase 3 y logotipo. La app conserva su diseño horizontal dentro de una ventana; arriba va el nombre y abajo los subtítulos grandes.

Todo el audio es del motor: los ▶ de la app y, para los acordes, la salida real de la app.

## Segundo corte (2026-11-18)

Notas del autor sobre el primer corte, y lo que cambió:

- **Los acordes se trababan y sonaban sucios.** La app los tocaba en vivo mientras el navegador grababa la pantalla, y el audio se quedaba sin CPU, como FL cuando la demanda es muy alta. Ahora la app registra cada nota con su hora y el sonido se renderiza fuera de línea con el mismo sampler (raíz, ADSR y ganancia de la app), exacto a la muestra. En pantalla se ve lo mismo: las teclas y el cabezal.
- **Cortes de sonido abruptos y silencios.**
  - Entre escenas, la imagen y el sonido se funden en 0.45 s.
  - Cada sonido entra con un fundido corto y, si se corta, sale con 0.35 s.
  - Debajo de todo el video corre un **fondo** hecho con el pad hueco de T2, tocado lento y grave (Am – F – C – G). Baja solo (sidechain) cuando suena la demostración, así que nunca queda en silencio.
- **Las frases.** Ahora usan el diseño de la app:
  - un módulo con tornillos y un display con el espectrograma del sonido que se oye, bajo el cabezal;
  - las palabras suben una tras otra;
  - el cursor **selecciona** las palabras clave con el rectángulo de la app, en el color de una capa;
  - en la frase 3, "filter" y "sampler" se borran con la goma.

  El logotipo aparece letra por letra y la tecla FOURIERIZE se presiona.
- **T5 (golpe + cola) no se sentía como un sonido usable.** Lo reemplaza **una nota hecha de dos sonidos en C**: el golpe del teclado *Glass keys* (1.8 s, con un fundido de salida de 1.4 s) florece en el pad *Heaven* (completo, que entra lento). La suma suena como un solo instrumento. La escena cierra tocando un arpegio de Cmaj7 con él. Las otras pruebas (Glass + Grace, kalimba + cuerdas, piano + cuerdas) están en `Video previews/T5 nuevo (golpe + cuerpo)`.
- **El cuadro raro al cambiar de capa** era la transformación de la propia app a medio camino. Ahora el cambio ocurre bajo una imagen congelada y se disuelve. Las esperas de render se quitan del video, también bajo la imagen congelada.

Duraciones: trailer **2:51**, story **0:32**. Están en `Video drafts` como `*-draft2.mp4`.
