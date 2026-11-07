# Runtime patches

The runtime stays on llama.cpp `46ca246de9bb1c35269722a6240d37d9dfd79cad` and wllama 3.8.1.

- `llama-plamo3-tokenizer.patch`: pinned PLaMo tokenizer changes from PR #30045, including the local tokenizer corrections identified in the runtime manifest.
- `llama-wasm-relaxed-simd.patch`: corrected integer-dot kernels posted by daveycodez on 2026-10-31 in [llama.cpp PR #19590](https://github.com/ggml-org/llama.cpp/pull/19590#issuecomment-6536684785), extracted verbatim from that comment. SHA-256: `ae47f43b8e4161deee1d033bfb65e8a9adc55d31b80a02735d6b27c1548b1aaf`. The source also identifies [the patch at revision 1a58203](https://github.com/daveycodez/tanstack-ai-browser/blob/1a58203/packages/wllama/scripts/llama-cpp-relaxed-simd.patch).

The relaxed patch keeps the dot instruction's seven-bit operand in 0..127, with the appropriate offset correction, including Q6_K. Do not substitute the original PR's implementation, which passed signed operands outside that range. Its Q8_0 fast path assumes the quantizer's -127..127 range. Standard SIMD uses the portable-dot adaptation below; the original standard branch was rejected after a translation regression. These modifications extend MIT-licensed llama.cpp; its notice is retained in `../runtime/llama-LICENSE`.

`node scripts/rebuild-runtime.mjs --variant=simd` and `--variant=relaxed` build separate candidates and verify that the WASM-specific source is included. Archives and patches are checked before use. `--variant=profile` adds CPU-side WebGPU counters; `--variant=profile-gpu` additionally adds GPU timestamp queries. Profiling changes execution and is for diagnosis only; never promote those builds to the product.

After validating both candidates, `node scripts/promote-runtime.mjs` checks their hashes, decoded integer-dot instructions, versions, shared worker ABI, and identical symbol maps before copying them into `vendor/runtime` and updating both runtime manifests. It rejects profiling artifacts. Run `npm run check` and the private real-model regression suite after promotion. Ordinary extension builds do not require Emscripten; they use these checked-in binaries.

The product uses a feature probe before loading Relaxed SIMD and retries standard SIMD if initialization fails. Relaxed SIMD was checked against scalar reference results on arm64 and on x64 Node under Rosetta; physical Intel/AMD machines have not been tested. The 2026-11-07 local PLaMo comparison retained translation content with small wording differences; it does not establish bit-identical generation across backends.

`--variant=relaxed-batch128` is an unpromoted experiment that doubles the WebGPU submit batch. Compare it using a normal, uninstrumented build; do not infer performance from GPU timestamp profiling.

Run runtime variants sequentially: they deliberately share a freshly extracted staging source tree. The build pins Emscripten 6.0.13, wllama 3.8.1 and both source archives; changing these requires another round of ABI, numerical and real-model validation.

`llama-wasm-portable-dot.patch` is a local adaptation applied after the corrected upstream patch for standard-SIMD builds. It emulates the same four-byte integer-dot grouping with standard i16 dot, shuffle and add instructions, so the floating-point block-scale accumulation follows the same order as Relaxed SIMD. The upstream standard-SIMD branch changed a negative statement into an affirmative statement in the long English regression fixture, at both 600-character and full-paragraph settings. It is not shipped.

Portable patch SHA-256: `0c78ba0fe2ccce8ca4b79249929164d515893dcc3b78b18d2bb9ad097ba7da20`. Across 40,000 quantized dot cases, the portable and relaxed variants produced bit-identical outputs on ARM and x64 Node under Rosetta. Full-model fixtures are also checked separately; numerical kernel agreement alone is not a translation-quality guarantee.
