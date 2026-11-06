# Licenses and Attribution

Last updated: November 7, 2026

**Built with PLaMo.**

Glosside is published by Eito Yoneyama.

## 1. Original Glosside code

Copyright © 2026 Eito Yoneyama.
Original Glosside code and documentation are made available under the [MIT License](../LICENSE).
This grant covers the publisher's original contributions only.
It does not relicense PLaMo model materials, model outputs, or third-party code and assets.
Those materials remain subject to their respective terms below.

## 2. PLaMo model and outputs

Glosside uses **PLaMo 3 Translate 0.8B**, distributed by Preferred Networks, Inc. (PFN) as the `Q4_K_M` GGUF model.
Model weights are downloaded separately after the user accepts the model license; they are not included in the extension package.
The model and materials covered by PFN's agreement are governed by the **PLaMo Community License Agreement**.

Read the complete bundled agreement in [English](../vendor/plamo-en.txt) or [Japanese](../vendor/plamo-ja.txt), and consult [PFN's license page](https://plamo.preferredai.jp/info/plamo-community-license-en) for current terms.
The following is a summary of selected provisions, not a substitute for the agreement:

- **Eligibility:** Article 2 specifies age or legal-capacity requirements and the alternative of consent by a legal guardian or representative.
- **Commercial use:** Articles 1(9) and 3(3) define commercial purposes broadly, including product or service development and provision, and use within an organization. The community license requires prior registration with PFN and annual revenue or sales of the user or affiliated company not exceeding JPY 1 billion. If these conditions are not met, a separate commercial license from PFN is required. Distribution without a fee does not by itself establish that a use is non-commercial.
- **Redistribution:** Article 4 requires a copy of the agreement, recipient compliance, the attribution “Built with PLaMo,” and the specified naming requirement for AI models created using model materials.
- **Publishing output:** Article 5(1) requires clear identification of publicly distributed output as output of PLaMo or a derived model. Copying text from Glosside does not automatically add that identification. For example, identify it as “Translated with PLaMo 3 Translate via Glosside.”
- **Training on output:** Article 5(2) treats models trained using the output as derived models subject to the agreement.
- **Use restrictions and responsibility:** Articles 6, 7, and 9 impose use restrictions and user responsibilities. PFN provides the model and outputs without the warranties listed in Article 7, which also prohibits using outputs as the sole evidence, evaluation, or opinion for specified high-stakes assessments.

PFN provides a [commercial-use registration form](https://forms.gle/mTL8tBLrMYXKNZD56) and a [translation-model inquiry page](https://translate.preferredai.jp/llm/contact/).
Neither Glosside's MIT license nor this notice grants an exemption from PFN's terms or represents that PFN registration has been completed for a particular user or use.
Rights in source documents and other third-party content must also be respected.

## 3. Third-party software notices

The following notices accompany components used in the packaged extension and its inference runtime.
Each linked file preserves the upstream copyright and license text; those texts govern the corresponding material.

| Component                                                                                    | Copyright / attribution                                                         | License or notice                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| wllama 3.8.1                                                                                 | © 2024 Xuan Son NGUYEN                                                          | [MIT](../vendor/licenses/wllama.txt)                                                        |
| llama.cpp / ggml                                                                             | © 2023–2026 The ggml authors                                                    | [MIT](../vendor/runtime/llama-LICENSE)                                                      |
| hash-wasm 4.12.0                                                                             | © 2020 Dani Biró                                                                | [MIT and upstream notices](../vendor/licenses/hash-wasm.txt)                                |
| SHA-256 implementation used by hash-wasm                                                     | © 2010 Aleksey Kravchenko; modified by Dani Biró                                | [Permissive license and disclaimer](../vendor/licenses/hash-wasm-sha256.txt)                |
| Emscripten runtime support                                                                   | Emscripten authors and identified contributors                                  | [MIT / University of Illinois-NCSA and included notices](../vendor/licenses/emscripten.txt) |
| musl C library                                                                               | © 2005–2020 Rich Felker and contributors; additional attributions in the notice | [MIT and component notices](../vendor/licenses/musl.txt)                                    |
| Dawn WebGPU C++ bindings                                                                     | The Dawn & Tint Authors                                                         | [BSD 3-Clause](../vendor/licenses/dawn.txt)                                                 |
| Emscripten WebGPU support distributed with Dawn                                              | Emscripten authors                                                              | [MIT / University of Illinois-NCSA](../vendor/licenses/emdawnwebgpu.txt)                    |
| Embedded llama.cpp libraries: JSON for Modern C++, stb_image, miniaudio, SHA-256, and xxHash | Authors identified in the component notices                                     | [MIT, BSD, public-domain and alternative terms](../vendor/licenses/llama-components.txt)    |
| LLVM libc++, libc++abi, and compiler-rt                                                      | LLVM Project contributors and identified authors                                | [Apache 2.0 with LLVM Exceptions and retained notices](../vendor/licenses/llvm-runtime.txt) |
| musl component-specific notices                                                              | Sun Microsystems, Arm Limited, and other identified authors                     | [Additional source notices](../vendor/licenses/musl-components.txt)                         |

The build modifies wllama worker startup to use static extension resources and removes CDN runtime loading.
The vendored llama.cpp runtime includes the PLaMo tokenizer compatibility patch recorded in its manifest.
These modifications retain upstream notices.
The packaged `release-manifest.json` records the model revision, dependency versions, and runtime build identifiers.

Development and build dependencies have their own upstream licenses.
The table describes packaged runtime components, not every tool installed by `npm ci`.
When redistributing or modifying Glosside, retain the applicable license texts and review the terms of any components you add or replace.

## 4. Warranties and applicable terms

The MIT License contains the warranty disclaimer and limitation of liability applicable to original Glosside contributions.
The PLaMo agreement and other third-party licenses contain their own provisions for their respective materials.
This notice does not replace those provisions or waive any rights that cannot be excluded under applicable law.
