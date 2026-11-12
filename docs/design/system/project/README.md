Fourierizer es un instrumento de laboratorio para diseñar sonidos: científico y exacto en lo que muestra, físico y juguetón en lo que se toca. La calidad de construcción viene del hardware de hace décadas y la claridad del software minimalista de hoy.

## Principios

1. **Construcción, no textura.** La referencia a hardware llega por la estructura: módulos atornillados (`fz-module` + `fz-screw`), serigrafía (`silk`), costuras (`seam`), teclas con un labio físico (`shadow-key`). Nunca con cromo, brillos, sombras difusas, metal cepillado ni degradados: eso es lo que hace ver un plugin "de los 2000".
2. **El color es la capa.** El chasis es gris y tinta. Cada capa tiene un color (`layer-1` Mandarina, `layer-2` Césped, `layer-3` Panthers, `layer-4` Violeta) y ese color solo aparece en lo que pertenece a esa capa: su espectrograma, sus selecciones, su número, su LED y sus perillas.
3. **Datos sobrios, objetos juguetones.** Espectrogramas, ejes y números son exactos, en monoespaciada y sin animación decorativa. La alegría vive en lo que se toca: perillas que rebotan al saltar de valor, teclas que se hunden, LEDs que se encienden en secuencia.
4. **Todo número lleva unidad y su física.** ms, Hz, st, dB y dBFS siempre. Los valores técnicos muestran debajo lo que significan (N 4096 → 85.3 ms · Δf 11.7 Hz).
5. **Aire.** Densidad baja: `space-6` entre controles, `space-8` entre módulos, `space-12` entre regiones. La ventana es redimensionable; el espacio extra va a los displays, no a separar más los controles.

## Color

- Fondo de ventana: `chassis`. Módulos sobre él: `panel`. Displays (espectrograma, forma de onda): `display`.
- Texto, contornos y estados seleccionados: `ink`. Etiquetas, unidades y ticks de ejes: `ink-muted`. Texto sobre relleno de tinta: `on-ink`.
- Los colores de capa (`layer-N`) son **rellenos** y no pasan 3:1 sobre fondos claros, así que siempre llevan contorno `ink`. Para líneas y marcas que deben leerse solas (forma de onda, handles, picos del espectrograma) se usa `layer-N-deep`. Para glifos sobre un relleno de capa se usa `on-layer-N`.
- Nunca va texto pequeño sobre `layer-3`; ahí solo íconos e indicadores.
- `signal-rec` es exclusivo de la captura por sidechain y siempre va con la palabra REC. `signal-ok` siempre va con ícono o palabra.
- Las costuras y rejillas (`seam`) son decorativas: nunca son el único borde de un control.

## Tipografía

- Panel en Archivo (`sans`); valores en IBM Plex Mono (`mono`) con números tabulares.
- `wordmark`: solo el nombre "Fourierizer", una vez en el chasis.
- `title`: nombres de archivo y títulos de sección.
- `body`: estados vacíos y ayuda.
- `silk`: etiquetas bajo los controles, en mayúsculas y `ink-muted`, como serigrafía.
- `key`: texto en teclas.
- `readout-lg`: valor principal de un Stepper.
- `readout`: valores bajo perillas y faders.
- `readout-sm`: ticks de ejes y valores derivados.

## Controles: uno por tipo de parámetro

| Parámetro | Control | Ejemplos |
|---|---|---|
| Continuo, se ajusta de oído | **Knob** | ATK, DEC, SUS, REL, FTHR, GAIN, MIX |
| Niveles comparados lado a lado | **Fader** | mezcla L1–L4, salida |
| Exacto o discreto | **Stepper** | N, H, L, PITCH (st), FINE (ct), ROOT, VOICES |
| Uno de un conjunto | **Segmented** | ventana, Tape / Spectral, herramienta de selección |
| Acción o encendido/apagado | **Key** | Load, Rec, Mute, Solo, → Slot |
| La acción principal | **FourierizeKey** | Fourierize (solo una en pantalla) |

Cada control lleva **ícono + valor + abreviatura serigrafiada**: el ícono se lee rápido, la abreviatura evita la ambigüedad.

## Forma

- Radios: `radius-0` para displays (una pantalla es un corte en el panel), `radius-sm` para teclas, steppers y chips, `radius-md` para módulos, `radius-round` para caps, LEDs y tornillos.
- Trazos: `stroke-hair` para costuras y rejillas, `stroke-line` para contornos e íconos, `stroke-bold` para seleccionado, selecciones y foco.
- Sombras: solo `shadow-key` (labio plano) y `shadow-key-pressed`. Al presionar, la tecla baja exactamente esa profundidad.
- Foco de teclado: contorno sólido `ink` de `stroke-bold` con 3px de separación.

## Distribución

La ventana principal es una cuadrícula de 2 × 2 con las cuatro capas (cada una un LayerSlot con su SpectrogramDisplay), y debajo el resultado y el sampler: Fourierize, Tape / Spectral, ADSR y mezcla. El wordmark va una sola vez, arriba a la izquierda del chasis.

## Movimiento

- **Objetos:** rebote con sobrepaso (≈420 ms, `cubic-bezier(.3,1.7,.45,1)`) cuando un valor salta (reset o teclado). La manipulación directa no tiene retraso. Las teclas se hunden en 90 ms.
- **Datos:** sin animación decorativa. El cursor de reproducción se mueve de forma lineal.
- Con `prefers-reduced-motion` se apaga todo el movimiento.

## Iconografía

- Íconos de línea propios: retícula de 16 px, trazo `stroke-line`, extremos rectos, sin relleno, en `ink`.
- Los íconos de ventana del Segmented grafican la función real w[n]; son datos, no decoración.
- Sin emoji. *Pendiente:* el set completo de íconos se dibuja en la ronda 1.

## Texto de la interfaz

La UI va en inglés. Las abreviaturas serigrafiadas van en mayúsculas (ATK, REL, FTHR, WIN). Las acciones son verbos (Load, Rec, Fourierize). Los estados vacíos dicen qué hacer: "Drop a sound or capture from the mixer".
