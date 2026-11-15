# Videos de lanzamiento: guion (borrador 1)

Dos piezas:

1. **Trailer** horizontal (16:9, 1920 × 1080, 60 fps), unos 2:30, para YouTube.
2. **Story** vertical (9:16, 1080 × 1920), 30 s, para Instagram.

**Hilo de las dos:** "cualquier sonido se puede ver, recortar y tocar". La música es **tu beat hecho con Fourierizer**, la definición de terminado de la v2.0, así que el video también la demuestra.

**Estilo visual:** el de la app. Chasis claro, tinta negra, los cuatro colores de capa como único acento, tipografía Archivo (títulos) e IBM Plex Mono (datos y subtítulos). Nada de efectos brillantes: cortes secos, algún zoom lento y texto que aparece como lectura de un instrumento ("0.958 s · 775 Hz · G5 −21¢").

---

## 1. Trailer (≈ 2:30)

| Tiempo | Imagen | Audio | Texto en pantalla |
|---|---|---|---|
| 0:00–0:06 | Negro. Un espectrograma de voz se dibuja de izquierda a derecha con el cabezal. | La voz sola, seca. | — |
| 0:06–0:12 | Zoom out: es una capa de Fourierizer. Aparece el logotipo. | Entra un golpe grave del beat. | **FOURIERIZER** · *Time–frequency selection synth* |
| 0:12–0:24 | Se arrastran cuatro sonidos a las cuatro capas (piano, break, voz, lluvia); cada espectrograma aparece. | Cada sonido suena un instante al caer. | "Cualquier sonido es una imagen." |
| 0:24–0:50 | **Seleccionar.** Primeros planos de cuatro gestos: un rectángulo sobre el piano, un lazo sobre la voz, *Harmonics* tomando una nota con sus armónicos (y el cambio a *Odd*), *Wand* tomando un golpe del break. | Cada selección se escucha sola (▶ de la capa): el contraste entre "todo" y "lo seleccionado". | La herramienta en mono: `RECT`, `LASSO`, `HARMONICS · ODD`, `WAND` |
| 0:50–1:08 | **Fourierize.** Se dibuja el resultado. Cambio de operación Sum → Max → Cross con el espectrograma del resultado transformándose. | El resultado; cada operación suena distinta. | "Recorta. Combina." |
| 1:08–1:30 | **Tocarlo.** Pantalla dividida: tus manos en el MPK (video tuyo) y el cabezal recorriendo el resultado; cambio de Tape a Spectral y de Tonal a Punchy. | Acordes con el sonido nuevo; Tape vs Spectral en las mismas teclas. | "Tócalo." · `TAPE` / `SPECTRAL` |
| 1:30–1:48 | **Iterar.** Keep → Send to layer → una selección sobre el resultado → el panel Takes con el linaje ("3 ← Take 2"). | La segunda generación del sonido. | "Vuelve a empezar desde lo que hiciste." |
| 1:48–2:05 | **Capture.** FL Studio: Capture en una pista, START ON SIGNAL, tú tocando un instrumento o sinte; el archivo aparece en el menú ⤓ de una capa. | Lo que grabas, y luego seleccionado. | "Graba desde tu mixer." |
| 2:05–2:15 | **Ver de cerca.** El análisis del resultado con zoom; Resolution Multi en el break (los golpes se afilan). | Un fragmento del beat. | `ANALYSIS` · `MULTI-RES` |
| 2:15–2:30 | **El beat.** Tu beat completo, con planos rápidos de las capas que lo forman; cierre en el logotipo. | El beat. | **FOURIERIZER** · "Gratis · Código abierto · Windows y macOS · VST3 + app" · enlace |

## 2. Story (30 s)

Pensada para verse sin sonido, y mejor con sonido. El texto es grande y se lee en 1 s.

| Tiempo | Imagen (vertical) | Audio | Texto |
|---|---|---|---|
| 0–2 s | Un espectrograma en vertical (el tiempo hacia abajo), muy cerca, dibujándose. | Un golpe del beat. | **"Convierte cualquier sonido en un instrumento."** |
| 2–8 s | Cae un sonido en una capa (recorte vertical de la UI); un lazo lo rodea. | El sonido, luego solo lo seleccionado. | "Selecciónalo." |
| 8–14 s | *Harmonics* sobre una nota, cambio a *Odd*. | El cambio de timbre. | "Quédate con sus armónicos." |
| 14–22 s | Tus manos en el MPK y el resultado tocándose. | Acordes. | "Tócalo." |
| 22–27 s | Entra el beat; cortes al ritmo entre capas. | El beat. | — |
| 27–30 s | Logotipo sobre el chasis. | Final del beat. | **FOURIERIZER** · "Gratis · link en bio" |

---

## Cómo se produce

- **Pantalla:** grabada de forma automática con la app real. Un guion de puppeteer hace cada gesto con tiempos exactos y guarda los cuadros; se le añade un cursor dibujado, porque la captura no lo incluye. Todo se puede repetir hasta que quede bien, sin grabar a mano.
- **Audio exacto:** los resultados y las notas se generan con el mismo motor del plugin, sin grabar la tarjeta de sonido, así que imagen y sonido quedan sincronizados al cuadro.
- **Edición:** con ffmpeg, a partir de un guion de tiempos. Los textos se componen con las tipografías de la app. El formato vertical recorta y acerca partes de la UI, no la encoge entera.
- **Lo que solo tú puedes poner:** el beat y, si quieres, los clips de tus manos.

## Lo que necesito de ti

1. **Idioma del texto en pantalla:** español, inglés o los dos (por ejemplo, el trailer en inglés y la story en español).
2. **El beat:** de 30 a 60 s, hecho con sonidos fourierizados. Si es posible, también los 2–4 sonidos fuente que usaste, porque saldrán en pantalla y deben ser tuyos o libres de derechos.
3. **¿Clips tuyos?** Tus manos en el MPK y, para la parte de Capture, tocando algo. Un teléfono en vertical u horizontal sirve.
4. **El enlace del final:** el repositorio, una página de descarga o tu perfil.
