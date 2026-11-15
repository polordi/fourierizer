# Third-party notices

Fourierizer and Fourierizer Capture are licensed under the GNU Affero General Public License v3
(see [LICENSE](LICENSE)). They are built with the following third-party software. Each keeps its
own license; the full texts are in the linked files of each project.

| Component | Used for | License |
|---|---|---|
| [JUCE 8](https://juce.com) | Plugin framework (VST3, Standalone, audio I/O, UI host) | GNU AGPLv3 (dual-licensed with the commercial JUCE licence) |
| [VST 3 SDK](https://github.com/steinbergmedia/vst3sdk) (bundled with JUCE) | VST3 plugin format | MIT, © Steinberg Media Technologies GmbH |
| FLAC, Ogg Vorbis, zlib, libpng, HarfBuzz, SheenBidi, CHOC/QuickJS (bundled with JUCE) | Audio file formats, compression, fonts, scripting | BSD, zlib, MIT, Apache 2.0, ISC (see `JUCE/LICENSE.md`) |
| [Microsoft WebView2 SDK](https://www.nuget.org/packages/Microsoft.Web.WebView2) (Windows, static loader) | The plugin's window (web UI) | BSD-3-Clause, © Microsoft Corporation |
| [Archivo](https://github.com/Omnibus-Type/Archivo) | UI typeface | SIL Open Font License 1.1 |
| [IBM Plex Mono](https://github.com/IBM/plex) | UI typeface (readouts) | SIL Open Font License 1.1 |
| [nlohmann/json](https://github.com/nlohmann/json) | Test suite only (not in the plugins) | MIT |
| [esbuild](https://esbuild.github.io), [TypeScript](https://www.typescriptlang.org), [puppeteer-core](https://pptr.dev) | Build and test tools only | MIT, Apache 2.0 |
| [NumPy](https://numpy.org), [SciPy](https://scipy.org), [soundfile](https://github.com/bastibe/python-soundfile) | Python reference engine only | BSD-3-Clause |

VST is a registered trademark of Steinberg Media Technologies GmbH.
