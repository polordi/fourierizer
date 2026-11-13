# H3 · Demo web: bitácora

Cada concepto viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

## Qué construimos

La interfaz completa de Fourierizer funcionando en el navegador (artifact), con un motor de síntesis en TypeScript que reproduce el de Python a 10⁻⁹. Es la **misma interfaz** que irá dentro del plugin (H5): lo que se aprueba en el demo es lo que se verá en FL.

## Ronda de feedback #1 (2026-11-12)

| Nota | Qué se hizo |
|---|---|
| Los botones *Auto* y *→ Slot* no eran claros | Ahora son **Auto-render** y **Send to layer**; el selector de capa se abre como panel flotante. |
| Mover y redimensionar selecciones; eliminarlas | Clic en una selección la marca: se arrastra para moverla, el rectángulo tiene 8 manijas (ancho y alto libres) y el lasso 4 esquinas que escalan **sin deformar**. Un panel flotante ofrece *Fade in*, *Fade out* y eliminar. |
| Que el sonido no se corte de golpe | *Fade in* y *fade out* por selección (0–4 s), **dentro** de la selección y **por frecuencia** (PLAN §4.3). El relleno de la selección muestra la envolvente exacta. |
| Explicar los controles que no son obvios | Tooltips propios (aparecen al detenerse sobre un control o con Tab) para ventanas, N, H, offset, pitch, feather, fades, keytrack, root, envolvente, niveles, M y S. Todos los textos viven en [help.ts](../../../ui/src/view/help.ts). |
| Escuchar la selección de cada capa | Botón ▶ por capa: suena solo esa selección (con su pitch y fades, sin offset ni nivel), con un cabezal sobre su espectrograma. |

## Conceptos nuevos

**Un solo código para el navegador y el plugin**
- *En simple:* la interfaz no sabe si está en el navegador o dentro de FL. Le pide cosas a un "motor" a través de un intermediario, y cada lugar pone su propio motor detrás.
- *En técnico:* la UI solo habla con la interfaz `Host` ([host.ts](../../../ui/src/host.ts)). En el navegador la implementa `BrowserHost` con un **Web Worker**. En el plugin la implementará un puente nativo hacia el core C++ con los mismos mensajes ([protocol.ts](../../../ui/src/protocol.ts)).

**Golden files**
- *En simple:* Python es el "maestro". Genera resultados de referencia y cualquier otra versión del motor tiene que copiarlos casi al pie de la letra (diferencia menor a una milmillonésima).
- *En técnico:* [make_golden.py](../../../python/golden/make_golden.py) escribe JSON con entradas y salidas (ventanas, resíntesis en cinco mallas, render, máscaras con fades, resampler). Las suites de TypeScript y C++ los cargan y exigen error máximo < 1e-9. Si alguien cambia la matemática en un lugar, las pruebas lo detectan en los demás.

**Desvanecido por renglón de frecuencia**
- *En simple:* en un lasso, cada frecuencia termina en un momento distinto, así que cada una se desvanece hacia su propio borde (la punta de un triángulo se apaga antes que su base).
- *En técnico:* la máscara del objeto se multiplica por E(t, φ) = maxⱼ S((t − aⱼ(φ))/τ_in)·S((bⱼ(φ) − t)/τ_out), donde [aⱼ, bⱼ] son los intervalos que el polígono cubre en el renglón φ (regla par-impar) y S es un coseno elevado. Fuera del rango de frecuencias del polígono se usa el renglón más cercano para que el feather en frecuencia siga siendo continuo.
