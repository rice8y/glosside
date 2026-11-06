# Third-party notice sources

These are retained upstream notices for the packaged runtime, not licenses for original Glosside code.
The build copies them into `dist/vendor/licenses/`.

| File | Source |
| --- | --- |
| `wllama.txt` | `@wllama/wllama` 3.8.1, `LICENCE` |
| `hash-wasm.txt` | `hash-wasm` 4.12.0, `LICENSE` |
| `hash-wasm-sha256.txt` | `hash-wasm` 4.12.0, leading notice in `src/sha256.c` |
| `emscripten.txt` | Emscripten 6.0.13, `LICENSE` |
| `musl.txt` | Emscripten 6.0.13, `system/lib/libc/musl/COPYRIGHT` |
| `dawn.txt` | Dawn `v20260317.182325`, `emdawnwebgpu_pkg/webgpu_cpp/LICENSE` |
| `emdawnwebgpu.txt` | Dawn `v20260317.182325`, `emdawnwebgpu_pkg/webgpu/src/LICENSE` |
| `llama-components.txt` | Notices from the pinned llama.cpp runtime's `vendor/nlohmann/json.hpp`, `vendor/stb/stb_image.h`, `vendor/miniaudio/miniaudio.h`, and `vendor/hash/`; JSON SPDX author notices are followed by the standard MIT text |
| `llvm-runtime.txt` | Emscripten 6.0.13, `system/lib/{libcxx,libcxxabi,compiler-rt}/LICENSE.TXT` |
| `musl-components.txt` | Copyright and license comment blocks from musl source files identified in the pinned runtime's WebAssembly source map |

PLaMo agreements are retained in `../plamo-en.txt` and `../plamo-ja.txt`.
The llama.cpp notice is retained in `../runtime/llama-LICENSE`.
When changing pinned dependencies or rebuilding the runtime, review the corresponding source notices as well as the binaries.
