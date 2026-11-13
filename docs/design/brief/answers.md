# Brief de diseño: respuestas (ronda 0, 2026-11-12)

Fuente: [cuestionario](https://claude.ai/artifact/LiPkSDsoYdWTBtYxPKqwn4) (`brief/answers`, versión 60).

| Módulo | Elección |
|---|---|
| Capa 1 | Mandarina `#F28C28` |
| Capa 2 | Césped `#10A04A` |
| Capa 3 | Panthers `#0085CA` |
| Capa 4 | Violeta `#7A3FD1` |
| Fondo | Gris frío `#E4E7EA` |
| Cantidad de color | Solo acentos |
| Tipografía | Grotesca (Archivo) + monoespaciada (IBM Plex Mono) para números |
| Controles | **Mixto según el parámetro**: perillas, faders o valores numéricos donde cada uno sea más pertinente |
| Esquinas | Apenas redondeadas |
| Densidad | Aireada |
| Referencia a hardware | Marcada |
| Espectrograma | Color de la capa |
| Organización | Cuadrícula 2 × 2 + resultado |
| Animación | Juguetona |
| Etiquetas | Íconos + valores |
| Ventana | Redimensionable |

**Adjetivos:** científico; de diseñador, pero también de laboratorio.

**Le encantan:** OP-1, EP-133 K.O. II, Claude, la página de Teenage Engineering, las Mac, las MPC, las cafeteras modernas.

**Evitar:** la estética de FL Studio; que parezca hecho en los 90 o en los 2000; los degradados; la estética tipo Serum.

**Idea rectora (en sus palabras):** "Algo mucho más moderno pero que también tenga elementos de hace varias décadas: combinar el diseño de hardware de hace muchos años, que normalmente era de mucha mayor calidad, con el diseño de software moderno minimalista."

## Interpretación (para validar en la ronda 1)

1. **Hardware "marcado" sin verse de los 2000.** La referencia a hardware llega por la *construcción* y no por las *texturas*. Sí entran:
   - costuras de panel, serigrafía (etiquetas impresas), tornillos dibujados planos;
   - proporciones y tolerancias de objeto real;
   - la escuela industrial de los 60 y 70 (Braun / Dieter Rams, instrumentos de laboratorio, las MPC clásicas).

   No entran el cromo, los brillos, las sombras realistas ni el metal cepillado, que son justo lo que hace ver "2000s" a un plugin. El hardware se dibuja con trazo plano.
2. **"Íconos + valores" con espíritu de laboratorio.** Un instrumento de laboratorio etiqueta todo. Propuesta: cada control lleva su ícono, su valor y una abreviatura pequeña serigrafiada (ATK, REL, WIN…). El ícono se lee rápido; la abreviatura evita ambigüedad.
3. **"Juguetona" sin perder lo científico.** El juego va en los objetos que se tocan (perillas con rebote, botones que se hunden, la palanca de "Fourierize"). Los datos (espectrogramas, ejes, números) son sobrios y exactos.
4. **Mucho color en pantalla con "solo acentos".** El chasis es gris y negro. El color vive en lo que *pertenece a una capa*: su espectrograma, sus selecciones, su perilla. Como el espectrograma es grande, el color se siente protagonista sin pintar paneles enteros.
5. **Controles por tipo de parámetro** (regla del sistema de diseño):
   - **Perilla:** continuos con rango acotado y que se ajustan "de oído" (ganancia, feather, ADSR).
   - **Fader:** niveles comparables lado a lado (mezcla de las 4 capas).
   - **Valor numérico con ±:** discretos o exactos (N, H, semitonos, nota raíz, voces).
   - **Selector segmentado:** opciones (ventana, Tape/Spectral).

## Ronda 1 · distribución de la ventana (2026-11-12)

Fuente: [lienzo de mockups](https://claude.ai/artifact/2fatUahm41tSWiQMWQVHch).

Se presentaron tres distribuciones: A (cuadrícula 2×2 + resultado), B (editor enfocado con riel de capas) y C (carriles sobre una línea de tiempo compartida).

**Decisión:** A y B combinadas; C se descarta.

- La ventana arranca en la cuadrícula 2×2 (A).
- Cada capa tiene un botón de enfoque. Al presionarlo, la capa crece hasta ocupar el editor de B y las otras tres se encogen al riel lateral. La animación usa el rebote del sistema de diseño (~560 ms) y va escalonada por capa.
- Desde el editor se vuelve a la cuadrícula o se salta a otra capa desde el riel. En la barra superior hay además un selector *View: Grid · 1–4*.
- El resultado, el sampler (Keytrack, Root, ADSR) y la mezcla (faders L1–L4) quedan fijos abajo en ambas vistas.

Veredicto del usuario sobre el prototipo interactivo: "Está impresionante. Me fascina."
