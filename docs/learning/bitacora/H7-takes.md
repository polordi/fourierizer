# H7 · Capas pro: historial de tomas (bitácora)

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

## Qué construimos

El **historial de iteraciones** del plan (§3.5). Cada resultado que te gusta se guarda como una **toma** (*take*) con su receta: qué sonido había en cada capa, las selecciones, la operación y el resultado. Puedes:

| Acción | Dónde | Qué hace |
|---|---|---|
| **Keep** | Módulo Result | Guarda el resultado actual como toma ("Take 3"). El botón cambia a *Kept* hasta el siguiente render. |
| **Send to layer** | Módulo Result | Igual que antes, pero primero guarda la toma; la capa toma su nombre ("Take 3"), así siempre sabes de dónde salió. |
| **Takes** | Encabezado, junto a Display | La lista: miniatura del espectrograma, operación, duración, hora y receta. |
| ▶ | Cada toma | La escuchas sin tocar nada de lo que tienes. |
| **Restore** | Cada toma | Vuelve todo a como estaba: capas, selecciones, operación y resultado. Pide un segundo clic. El sampler (envolvente, root, Tape/Spectral) y la vista no cambian. |
| **To 1–4** | Cada toma | Manda esa toma (aunque sea vieja) a una capa para iterar desde ella. |
| Renombrar / borrar | Doble clic en el nombre / 🗑 | Borrar pide un segundo clic. |

La receta muestra el linaje: "3 ← Take 2" quiere decir que la capa 3 era la toma 2. Matemáticamente es la composición del plan, y⁽²⁾ = F(y⁽¹⁾, x₂, …).

## Cómo funciona

**Guardar una toma no copia el audio**
- *En simple:* una toma apunta a los mismos sonidos que ya estaban cargados; solo ocupa memoria nueva el resultado. Si después cambias un sonido de una capa, el viejo se queda vivo porque una toma lo sigue usando.
- *En técnico:* las fuentes son `std::shared_ptr<const fz::Channels>`; una toma copia el arreglo de 4 fuentes (punteros) y el `shared_ptr` del resultado. La miniatura (160 × 40) se calcula al guardar y el resultado se codifica a FLAC en segundo plano.

**El proyecto guarda cada audio una sola vez**
- *En simple:* aunque cinco tomas usen el mismo piano, el `.flp` lo guarda una vez.
- *En técnico:* estado **versión 2**: nodos `Audio` (FLAC 24-bit, únicos por puntero), y `Layer` / `TakeLayer` que se refieren a ellos por índice; cada `Take` guarda su receta (proyecto de la UI y petición de render), el resultado en FLAC y la miniatura. El resultado de una toma se decodifica hasta que lo usas (▶, Restore, To). Los proyectos guardados con la versión anterior (una FLAC por capa) se siguen abriendo. Máximo 24 tomas.

**Restaurar no vuelve a calcular**
- *En simple:* al restaurar oyes exactamente el resultado que guardaste, aunque el motor cambie en el futuro.
- *En técnico:* `restoreTake` instala las fuentes, el proyecto, la petición y el audio guardado directamente en el sampler y en el banco Spectral, sin render. Si luego editas algo, el auto-render parte de esa receta.

## Presets

El plan también mencionaba presets. Para proyectos completos ya existen dos caminos, sin código nuevo:

- **En FL:** *Save preset as…* en el menú del plugin guarda todo el estado, tomas incluidas.
- **En la app:** *Options → Save current state*.

Queda pendiente de tu feedback si quieres además un navegador de presets propio dentro de Fourierizer (por ejemplo, plantillas de análisis por tipo de sonido).

## Pruebas (2026-11-14)

- ✅ Demo y app Standalone (puppeteer): Keep → *Kept* · Takes 1; un render nuevo regresa a *Keep*; Send to layer 4 crea "Take 2" y la capa 4 se llama "Take 2"; ▶ suena y cambia a ■; Restore de la primera toma regresa a Sum y a la capa 4 original; To 3 manda la toma 2 a la capa 3; borrar deja una toma menos.
- ✅ Persistencia: se cierra la app y se reabre. Las tomas siguen ahí con su receta, y Restore decodifica el FLAC guardado y vuelve a poner capas, operación y resultado.
- ✅ pluginval nivel 8, prueba del sampler y las pruebas de la ronda anterior (A/B, New, Display).

**Arreglos de paso**
- *New* reseteaba el switch Tape/Spectral de la interfaz aunque el plugin siguiera en Spectral. Ahora New conserva el modo.
- En el plugin, el aviso de "terminó de sonar" de una vista previa podía llegar antes que el de "empezó", porque la reproducción se reporta por eventos. Ahora hay 400 ms de gracia.
