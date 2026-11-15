# Fourierizer · Manual

Fourierizer es un instrumento para diseñar sonidos a partir de otros sonidos. Cargas hasta cuatro audios, ves su espectrograma (qué frecuencias suenan en cada instante), seleccionas las partes que te interesan de cada uno y Fourierizer sintetiza un sonido nuevo con esas selecciones. Ese sonido se toca con tu teclado MIDI.

Viene en tres piezas:

| Pieza | Qué es |
|---|---|
| **Fourierizer** (VST3) | El instrumento, dentro de FL Studio o cualquier DAW con VST3. |
| **Fourierizer** (app) | El mismo instrumento, sin abrir ningún DAW. |
| **Fourierizer Capture** (VST3) | Un efecto para el mixer que graba una pista y se la pasa a Fourierizer. |

---

## 1. Instalación

### Windows

1. Abre `Fourierizer-x.y.z-Windows-Setup.exe`. Si Windows muestra "Windows protegió tu PC", elige **Más información → Ejecutar de todas formas**. Aparece porque el instalador no está firmado con un certificado de pago.
2. Deja marcadas las tres piezas. Los plugins se instalan en `C:\Program Files\Common Files\VST3`, donde los busca FL Studio.
3. En FL Studio: *Options → Manage plugins → Find installed plugins*. Aparecen **Fourierizer** (generador) y **Fourierizer Capture** (efecto), de *waves_p*.

### macOS

1. Abre `Fourierizer-x.y.z-macOS.pkg` con **clic derecho → Abrir** (la primera vez). El instalador no está notarizado por Apple: con doble clic, macOS lo bloquearía.
2. Los plugins quedan en `/Library/Audio/Plug-Ins/VST3` y la app en *Aplicaciones*.
3. En tu DAW, vuelve a escanear los plugins.

### La app sin DAW

Ábrela desde el menú Inicio (Windows) o *Aplicaciones* (Mac).

- El botón **Options**, arriba a la izquierda, tiene *Audio/MIDI Settings*: ahí eliges la salida de audio y activas tu teclado MIDI.
- *Save current state* y *Load a saved state* guardan y abren proyectos como archivos.
- Al cerrarla, la app recuerda el último proyecto.

---

## 2. En un minuto

1. **Arrastra** un sonido (WAV, AIFF, FLAC, MP3 u OGG; hasta 60 s) a una de las cuatro capas, o usa el botón ⤓ de la capa.
2. **Selecciona** sobre el espectrograma: un rectángulo con *Rect*, una forma libre con *Lasso*…
3. El **resultado** se calcula solo (*Auto-render*) y aparece abajo.
4. **Tócalo** con tu teclado MIDI, o con el de la computadora (A–L).
5. Cuando algo te guste, presiona **Keep**.

---

## 3. La pantalla

```
┌ encabezado: View · Tool · Display · Takes · New · deshacer ┐
├ las cuatro capas (cuadrícula, o una ampliada)               ┤
└ Result · Sampler · niveles de las capas                     ┘
```

### View (vista)

- **Grid** muestra las cuatro capas.
- **1–4** amplía una capa para editarla. También la abres con su botón ⛶ o con las teclas 1–4; las teclas 0 o Esc regresan a Grid.
- **R** abre el análisis del resultado (también con la tecla 5).

### Una capa

- **Encabezado:** nombre, ⤓ cargar, ⏏ quitar el sonido, **Orig**, ▶, **M** (mute) y **S** (solo).
  - ▶ escucha solo lo que seleccionaste de esa capa.
  - Con **Orig** encendido escuchas el sonido original. Mientras suena puedes cambiar entre selección y original para compararlos (A/B).
- **El espectrograma:**
  - El tiempo va de izquierda a derecha y la frecuencia de abajo hacia arriba.
  - A la izquierda hay un piano: cada raya marca un Do, y la tecla azul es el *Root* del sampler.
  - En la vista ampliada, la lectura de la esquina dice tiempo, frecuencia y nota bajo el cursor.
- **Zoom (vista ampliada):**
  - la rueda del mouse acerca o aleja en el tiempo;
  - Shift + rueda se mueve;
  - **×N · Fit**, o doble clic en el eje de tiempo, regresa al sonido completo.
- **Parámetros (vista ampliada):**
  - **Window:** la forma de la ventana del análisis. Hann es un buen punto de partida.
  - **FFT size N:** ventanas grandes separan mejor las notas graves; ventanas chicas muestran mejor los golpes.
  - **Resolution:** *Single* usa una sola ventana; con *Multi*, los graves usan una 4× más larga y los agudos una 4× más corta.
  - **Hop H:** cada cuánto se analiza; menos hop es más fino y más lento.
  - **Offset:** retrasa o adelanta la capa en el resultado.
  - **Pitch:** transpone la capa antes de analizarla (como cinta: cambia también la duración).
  - **Fthr** (feather): qué tan suaves son los bordes de las selecciones.

### Tool (herramientas de selección)

| Herramienta | Cómo se usa |
|---|---|
| **Rect** | Arrastra un rectángulo. Con **Alt**, resta en lugar de sumar. |
| **Lasso** | Dibuja una forma libre. |
| **Harmonics** | Arrastra a lo largo del fundamental de una nota, o da clic para todo el sonido. Se selecciona la nota con todos sus armónicos (un "peine"). |
| **Wand** | Varita mágica: da clic en algo que se vea (una nota, un golpe, una cola) y se selecciona la zona alrededor. |
| **Erase** | Arrastra para quitar de la selección. |
| **Move** | Solo elige y mueve selecciones, nunca dibuja. |

**Editar una selección.** Dale clic para elegirla.

- Arrástrala para moverla en tiempo y frecuencia, o usa sus manijas para cambiar su tamaño.
- **Supr** la borra.
- Aparece una barra con sus controles:
  - **Fade in / Fade out:** que la selección entre o salga gradualmente, en vez de cortar de golpe.
  - **Peine** (*Harmonics*): **All / Odd / Even** (todos los armónicos, solo impares —suena hueco, como clarinete— o solo pares), **Harm** (cuántos) y **Width** (qué tan anchas las franjas, en cents).
  - **Varita** (*Wand*): **Range**, cuántos dB por debajo del punto clicado sigue seleccionando. Más rango toma colas y reverb.

**Deshacer:** Ctrl+Z. **Rehacer:** Ctrl+Shift+Z o Ctrl+Y.

### Result (el resultado)

- **Fourierize** calcula el resultado. Con **Auto-render** encendido se recalcula solo con cada cambio.
- **Operaciones:**
  - **Sum:** todas las selecciones suenan juntas.
  - **Max:** en cada punto gana la capa más fuerte, como un collage.
  - **Cross:** el cuerpo de A con el movimiento de B.
  - **Prod:** A "imprime" su forma sobre B.
- **Send to layer:** manda el resultado a una capa para seleccionar partes de él otra vez. Así se itera.
- **WAV** exporta el resultado a un archivo; **Drag** lo arrastra al playlist o a un sampler (solo en el plugin).
- **Keep** guarda el resultado como *toma*.
- ⛶ abre el **análisis**:
  - un espectrograma detallado con zoom y tamaño de FFT a elegir;
  - la forma de onda;
  - el espectro bajo el cursor, con la nota del pico;
  - el nivel en dBFS.

### Takes (historial)

Cada resultado que guardas (Keep, o al mandarlo a una capa) queda en **Takes** con su receta: qué sonido había en cada capa y de qué toma salió ("3 ← Take 2").

- **▶** la escucha.
- **Restore** regresa todo a como estaba: capas, selecciones, operación y resultado. El sampler no cambia.
- **To 1–4** la manda a una capa.
- **Doble clic** en el nombre la renombra.

Las tomas se guardan con el proyecto.

### Sampler (cómo suena al tocar)

- **Keytrack:**
  - **Tape** es como una cinta: las notas agudas suenan más rápido y más cortas.
  - **Spectral** cambia la nota sin cambiar la duración. La barra dentro de la tecla se llena mientras se preparan las notas.
  - Con Spectral, elige la ventana: **Tonal** (pads y acordes), **Mixed** o **Punchy** (golpes).
- **Root:** la nota en la que el resultado suena tal cual.
- **Atk / Dec / Sus / Rel:** la envolvente de cada nota.

En el plugin, todos estos son parámetros del host: en FL los ligas a tu controlador con clic derecho → *Link to controller*.

**Teclado de la computadora:** A–L tocan las teclas blancas (W, E, T, Y, U, O, P las negras) y Z / X bajan o suben una octava. Espacio toca el Root.

### Display

Ajusta cómo se ven los espectrogramas, sin cambiar el sonido:

- escala **Log / Lin**;
- frecuencias mínima y máxima;
- **Range** (contraste) y **Gain** (brillo);
- etiquetas del eje en **Hz** o en **Notes**.

### New

Vacía las cuatro capas y el resultado. Conserva el sampler, la vista y las tomas.

---

## 4. Fourierizer Capture: grabar desde el mixer

En FL Studio un instrumento no puede recibir audio. Por eso existe Capture.

1. Pon **Fourierizer Capture** en una pista del mixer: tu bus de batería, un sinte, el micrófono…
2. Graba de una de estas formas:
   - **REC:** graba a mano, hasta 60 s.
   - **START ON SIGNAL:** activa esta opción y presiona REC. Capture espera ("WAITING") hasta que llega sonido por encima del umbral, que viene en −45 dB; lo ajustas arrastrando el recuadro o con la rueda. Así presionas REC y luego volteas a tu instrumento sin prisa. Los 50 ms anteriores al disparo también se guardan, para no cortar el ataque.
   - **RECORD WHILE PLAYING:** graba exactamente mientras FL reproduce. Sirve para capturar un loop.
3. En Fourierizer, el botón ⤓ de una capa lista tus **capturas recientes**. Un clic carga una.

Los archivos van a `Documentos/Fourierizer/Captures`, con el nombre de la pista (botón **OPEN FOLDER**). El sonido pasa por Capture sin cambios.

---

## 5. Guardar y compartir

- **En FL Studio:** todo se guarda dentro del proyecto (`.flp`): sonidos, selecciones, tomas y ajustes. Al abrirlo, Fourierizer suena aunque no abras su ventana.
- **Presets:** *Save preset as…* en el menú del plugin de FL guarda el estado completo.
- **En la app:** *Options → Save current state*.

---

## 6. Problemas comunes

| Problema | Solución |
|---|---|
| FL no muestra el plugin | *Options → Manage plugins*: revisa que `C:\Program Files\Common Files\VST3` esté en las carpetas de búsqueda y da *Find installed plugins*. |
| No suena en la app | *Options → Audio/MIDI Settings*: elige tu salida de audio y activa tu teclado MIDI. |
| La primera nota lejana en Spectral tarda un poco | Es la primera vez que se calcula esa nota (unos 10 ms). Después sale al instante. |
| Un sonido de más de 60 s | Se cargan los primeros 60 s. |
| En Mac, "no se puede abrir porque es de un desarrollador no identificado" | Clic derecho → Abrir, o *Ajustes del Sistema → Privacidad y seguridad → Abrir de todas formas*. |

---

## 7. Licencia

Fourierizer es software libre bajo la **GNU Affero General Public License v3**. El código fuente está en este repositorio. Los componentes de terceros y sus licencias están en [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
