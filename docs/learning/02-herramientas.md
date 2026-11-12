# Las herramientas del taller

Esto es lo que instala [scripts/setup-windows.ps1](../../scripts/setup-windows.ps1). Cada herramienta viene en dos versiones:

- **En simple:** para alguien que nunca ha hecho un plugin.
- **En técnico:** cómo se lo dirías a alguien de la industria.

| Herramienta | En simple | En técnico |
|---|---|---|
| **Visual Studio 2022 Build Tools** | El "traductor" que convierte el código C++ en un archivo que Windows puede ejecutar. Solo el traductor, sin el editor gigante de Visual Studio. | Toolchain **MSVC** (compilador `cl.exe`, linker `link.exe`) + **Windows SDK** (headers y librerías del sistema), workload *VCTools*. |
| **CMake** | La "receta" del proyecto: dice qué archivos hay, qué librerías usan y qué se quiere construir (un VST3, un standalone, los tests). La misma receta sirve en Windows y Mac. | **Build system generator**: lee `CMakeLists.txt` y genera el proyecto para el backend elegido (Ninja, Visual Studio, Xcode). Maneja targets, dependencias y opciones de compilación. |
| **Ninja** | El "cocinero rápido" que sigue la receta de CMake y solo recompila lo que cambió. | **Build runner** minimalista y paralelo; CMake genera `build.ninja`. Es el estándar en CI. |
| **Node.js** | Permite usar las herramientas de desarrollo web con las que se construye la interfaz. | Runtime de JavaScript para el **toolchain del frontend**: `npm`, TypeScript (`tsc`) y el bundler **Vite**. No se distribuye con el plugin; solo se usa para construir la UI. |
| **WebView2 SDK** | Las piezas que le permiten a JUCE meter una "mini página web" dentro de la ventana del plugin en Windows. | Headers y librería de **Microsoft Edge WebView2** (paquete NuGet) para linking estático del backend `webview2` de `juce::WebBrowserComponent`. El *runtime* de WebView2 ya viene en Windows 11. |
| **Git** *(ya lo tenías)* | Un historial de todas las versiones del código, para poder volver atrás o trabajar en ideas por separado. | **Control de versiones** distribuido: commits, ramas (*branches*), merges. GitHub es el *remote* donde se respalda y se corre la CI. |
| **Python** *(ya lo tenías)* | El laboratorio matemático: ahí se prueban las ideas antes de llevarlas al plugin. | Implementación de referencia y generación de **golden files** para los tests de C++. |

## ¿Por qué un script y no instalar a mano?

- *En simple:* para que cualquier computadora (la tuya hoy, otra en un año, la de un colaborador) quede igual con un solo comando.
- *En técnico:* **reproducibilidad del entorno**. Es el mismo principio que usa la CI: el entorno se describe como código, en vez de recordarse. Este script se volverá parte de la plantilla de la fábrica de plugins.
