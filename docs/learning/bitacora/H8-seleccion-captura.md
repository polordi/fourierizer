# H8 · Selección armónica, varita y Fourierizer Capture (bitácora)

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

Alcance elegido: **armónica** y **varita** (el pincel, las booleanas y la multirresolución quedan para después) y el plugin compañero **Fourierizer Capture** (código `Fzcp`, permanente).

## Herramienta *Harmonics*: una nota con todos sus armónicos

- **Cómo se usa:** arrastras a lo largo del fundamental de una nota durante el tramo que quieres (un clic sin arrastrar toma todo el sonido). Se selecciona un **peine**: una franja en f₀, 2f₀, 3f₀…
- **El fundamental se ajusta solo** al parcial más fuerte que esté a menos de un semitono de donde diste clic, así no tienes que atinarle exacto.
- **Su barra** (al elegir el peine):
  - la nota y la frecuencia (por ejemplo "A3 +11¢ · 221.4 Hz");
  - **All / Odd / Even**: todos los armónicos, solo los impares (suena hueco, como un clarinete) o solo los pares (la octava arriba, más brillante);
  - **Harm**: cuántos armónicos (1–32);
  - **Width**: qué tan ancha es cada franja, en cents;
  - los fades de siempre.
- **Se edita como cualquier figura:** arrastrarla la mueve en tiempo y en tono, y sus extremos cambian el tramo.

**Cómo funciona**
- *En simple:* el motor no ve "16 rectángulos". Ve una sola figura nueva que sabe, para cada frecuencia, qué tan cerca está de algún armónico. Así el peine sigue siendo uno solo, con sus bordes suaves y sus fades.
- *En técnico:* nueva figura `harm` en los tres motores (Python, TS y C++). La distancia en frecuencia es la de la franja más cercana, d_φ = (w/2 − min_k |φ − log₂(k·f₀)|)/feather_oct, y se combina con la distancia en tiempo exactamente como un rectángulo (incluye esquinas, feather y fades). Como no depende del tiempo, se precalcula por bin. Los golden files tienen tres peines (todos, impares con resta, pares sin feather) y los tres motores coinciden **exactamente** (diferencia 0).
- **Límite:** f₀ es fija. Si la nota tiene glissando o vibrato fuerte, sube *Width* o usa dos peines. Seguir el tono en el tiempo sería una extensión posible.

## Herramienta *Wand* (varita mágica)

- **Cómo se usa:** das clic sobre algo que se vea en el espectrograma (una nota, un golpe, una cola) y se selecciona la zona conectada a ese punto con nivel parecido.
- **Range** (en su barra): cuántos dB por debajo del punto clicado sigue entrando. Más rango toma colas y reverb; menos rango solo el núcleo fuerte. Al moverlo, la zona se recalcula desde el mismo clic.

**Cómo funciona**
- *En simple:* es como el bote de pintura de un editor de imágenes, pero sobre el espectrograma. El borde de la mancha se convierte en un lazo normal, así que todo lo demás (mover, escalar, fades) funciona igual.
- *En técnico:* relleno por inundación con conexión 4 sobre la imagen del espectrograma (½ dB por paso). El contorno se sigue por las aristas de los píxeles, se toma el lazo de mayor área y se simplifica con Ramer–Douglas–Peucker hasta un máximo de 120 vértices (para que la máscara siga siendo rápida). El polígono guarda su semilla (t, f, tolerancia) solo en la interfaz; el motor ve un `poly` normal.

## Fourierizer Capture

**Por qué existe:** FL Studio no deja que un instrumento reciba audio (lo vimos en el spike H0). Capture es un efecto: lo pones en cualquier pista del mixer y graba lo que pasa por ella.

| Pieza | En simple | En técnico |
|---|---|---|
| **REC** | Graba a mano, hasta 60 s. | El archivo se crea en el hilo de mensajes y el hilo de audio solo le pasa muestras (`ThreadedWriter`, FIFO sin locks). |
| **Record while playing** | Empieza a grabar en el instante en que le das play en FL y para cuando lo detienes. Ideal para capturar un loop exacto. | Se prepara un archivo "armado" de antemano: el primer bloque con el transporte en *play* ya se escribe (no se pierde el ataque). Si llega a 60 s, corta y no vuelve a grabar hasta que se detenga el transporte. |
| **Archivos** | `Documentos/Fourierizer/Captures/<nombre de la pista> <fecha hora>.wav`, WAV 24-bit. | Nombre según `updateTrackProperties` del host. Las grabaciones de menos de 50 ms se descartan. El búfer tiene espacio para los 60 s completos (≈ 23 MB), así que no se pierde nada aunque el disco se trabe o el host exporte más rápido que tiempo real. |
| **En Fourierizer** | El botón de cargar (⤓) de cada capa abre un menú: *Browse files…* y tus capturas recientes ("1.5 s · just now"). Un clic la carga. | La lista se lee al abrir el menú (las 30 más recientes, sin las que se están grabando). Se carga como cualquier archivo: conversión a 48 kHz, máximo 60 s. |

El sonido pasa por Capture sin cambios: puedes dejarlo puesto en la pista.

## Pruebas (2026-11-14)

- ✅ Python: los números de armónico por paridad, y una máscara de peine con bordes duros que deja pasar 200, 400 y 600 Hz y bloquea 300, 500 y 800 (el 4º armónico ya no entra con count = 3). TS y C++ coinciden con Python con diferencia 0.
- ✅ Varita (prueba unitaria): traza exactamente un bloque de 10 × 5 (área 50); con 3 dB solo el renglón más fuerte; en silencio no selecciona nada; el ajuste del fundamental encuentra el renglón correcto.
- ✅ Demo y app Standalone (puppeteer): peine de 16 franjas con su barra; *Odd*; render del peine y de la varita por el motor C++; *Range* recalcula el contorno.
- ✅ [CaptureTest](../../../capture/tests/CaptureTest.cpp), sin host:
  - *Record while playing* graba 2.000 s y el archivo empieza en la primera muestra tocada;
  - REC a mano graba 1.00 s;
  - el límite de 60 s corta solo y no vuelve a empezar hasta que se detiene el transporte;
  - no deja archivos armados olvidados.

  Esta prueba encontró un bug real: con un búfer de 1.4 s, una exportación más rápida que tiempo real perdía audio. Se arregló dándole espacio para los 60 s.
- ✅ Menú de carga en la app: muestra la captura y la carga en la capa.
- ✅ pluginval nivel 8: Fourierizer y Fourierizer Capture.

## Cómo probarlo en FL Studio

1. Vuelve a escanear plugins: aparece **Fourierizer Capture** (waves_p) como efecto.
2. Ponlo en una pista del mixer (por ejemplo tu bus de batería) y activa **Record while playing**.
3. Dale play a tu patrón y detenlo. En la ventana de Capture aparece "Saved …".
4. En Fourierizer, botón ⤓ de una capa: tu captura está en la lista.
5. Prueba **Harmonics** en una nota sostenida (y *Odd*), y **Wand** en un golpe o en una cola.

## Ronda de feedback (2026-11-15): zoom, umbral de Capture y multirresolución

**Zoom de tiempo en la capa ampliada**
- *En simple:* en la vista expandida de una capa:
  - la rueda del mouse acerca o aleja en el tiempo, alrededor del cursor;
  - Shift + rueda (o el desplazamiento horizontal del trackpad) mueve la vista;
  - **×N · Fit**, o doble clic en el eje de tiempo, regresa al sonido completo.

  Las selecciones no se mueven: están en segundos reales. Puedes dibujar con precisión sobre un golpe ampliado.
- *En técnico:* la capa tiene una ventana de tiempo visible y todas las conversiones tiempo ↔ x pasan por ella (dibujo, manijas, mover, varita, peine). Al hacer zoom pide un espectrograma solo de ese tramo, con tantas columnas como píxeles y un salto de un marco por columna (como mucho el de la capa). Mientras llega, la imagen anterior se reubica al instante. Fuera de la vista expandida siempre se ve el sonido completo.

**Capture: START ON SIGNAL**
- *En simple:* activas **START ON SIGNAL**, presionas REC y Capture espera ("WAITING") hasta que entra algo más fuerte que el umbral. Así puedes voltear hacia tu instrumento sin prisa. El umbral viene en **−45 dB** (bajito) y se ajusta arrastrando el recuadro hacia arriba o abajo, o con la rueda; se ve como una marca azul en el medidor. REC mientras espera se convierte en CANCEL.
- *En técnico:* el hilo de audio compara el pico de cada bloque con el umbral y mientras espera guarda los últimos 50 ms en un búfer circular (reservado en `prepareToPlay`). Al cruzar el umbral escribe primero ese *pre-roll* y luego el bloque, para que no se corte el ataque. Probado: con ruido a −66 dB no arranca; con la nota sí, y el archivo dura la nota + 50 ms.

**Multirresolución (PLAN §3.4): Resolution Single / Multi**

Está en cada capa, debajo de *FFT size*.

- *En simple:* una sola ventana obliga a escoger: larga, los graves se distinguen bien pero los golpes se embarran; corta, al revés. Con **Multi**, la capa se divide en tres bandas:
  - los graves (debajo de ~300 Hz) usan una ventana 4× más larga;
  - los medios usan la tuya;
  - los agudos (arriba de ~3 kHz) usan una 4× más corta.

  Resultado: bajos limpios y transientes agudos precisos en la misma selección. El espectrograma lo muestra: cada franja de frecuencias se ve con la ventana de su banda.
- *En técnico:* cada banda es la misma resíntesis enmascarada en su propia malla (la de la capa escalada ×4, ×1 y ×¼, con la misma ventana, *zero-padding* y traslape), con la máscara multiplicada por un peso w_b(f). Los pesos cruzan con un coseno alzado en log f, una octava de ancho, y suman 1, así que con todo seleccionado las tres bandas reconstruyen la entrada (error < 2 % en la prueba). Aplica a **Sum**; Max, Cross y Product necesitan una malla común por definición. Python, TS y C++ coinciden (diferencia ~5e-16).
- **Display:** cada renglón del espectrograma sale de la imagen de la banda que domina esa frecuencia, comparando en dBFS (que no depende del tamaño de ventana). La banda grave se dibuja con el salto de la capa, para que no salgan columnas gruesas.
