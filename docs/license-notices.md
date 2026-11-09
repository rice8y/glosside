# Licenses and Attribution

Last updated: November 10, 2026

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

The bundled agreement is the November 9, 2026 revision, transcribed from PFN’s official Japanese and English pages. Source URLs, the revision date, and SHA-256 checksums are recorded in the model manifest. Model weights and tokenizer revisions remain pinned separately.

Read the complete bundled agreement in [English](../vendor/plamo-en.txt) or [Japanese](../vendor/plamo-ja.txt), and consult [PFN's license page](https://plamo.preferredai.jp/info/plamo-community-license-en) for current terms.
The following is a summary of selected provisions, not a substitute for the agreement:

- **Eligibility:** Article 2 specifies age or legal-capacity requirements and the alternative of consent by a legal guardian or representative.
- **Commercial use:** Articles 1(10) and 3(3) define commercial purposes broadly, including product or service development and provision, and use within an organization. The community license requires prior registration with PFN and annual revenue or sales of the user or affiliated company not exceeding JPY 1 billion. If these conditions are not met, a separate commercial license from PFN is required. Distribution without a fee does not by itself establish that a use is non-commercial.
- **Redistributing models:** Article 4 applies when providing the model or a derived model to third parties. It requires a copy of the agreement, recipient compliance, the attribution “Built with PLaMo,” the specified naming requirement for AI models, and compliance with other applicable licenses.
- **Publishing translations:** Article 1(6) defines conversion models, including models that solely translate input. Article 5(2) permits publication of their outputs without the attribution otherwise required by Article 5(1). If a translation forms all or a substantial part of a book, paper, or similar standalone long-form publication, indicate PLaMo’s use in a reasonable location such as the copyright page, acknowledgments, or the end. For example: “Translated with PLaMo 3 Translate via Glosside.” This attribution exception does not remove the separate notice obligation below.
- **Training on output:** Article 5(3) treats models trained using output as derived models subject to the agreement.
- **Providing output to others:** Article 5(4) requires a recipient-recognizable notice that models trained using the output are subject to this agreement. It covers providing or publicly releasing outputs, including datasets containing outputs; it is not limited to datasets intended for training.
- **Input and third-party rights:** Articles 9(2) and 10(3) clarify responsibility for obtaining necessary rights, permissions, and consents, and preserve applicable third-party rights in input content and outputs.
- **Use restrictions and responsibility:** Articles 6, 7, and 9 impose use restrictions and user responsibilities. PFN provides the model and outputs without the warranties listed in Article 7, which also prohibits using outputs as the sole evidence, evaluation, or opinion for specified high-stakes assessments.

PFN provides a [commercial-use registration form](https://forms.gle/mTL8tBLrMYXKNZD56) and a [translation-model inquiry page](https://translate.preferredai.jp/llm/contact/).
Neither Glosside's MIT license nor this notice grants an exemption from PFN's terms or represents that PFN registration has been completed for a particular user or use.
Rights in source documents and other third-party content must also be respected.

### Sharing from Glosside

Ordinary copy returns only the translation. Ordinary text export retains its existing source/translation format; neither includes the Article 5(4) training-use notice.
For external sharing, expand **Publishing and sharing** in the text translator or side panel, or in the selection popup’s additional actions, and choose **Copy with notice** or **Save with notice**.
These actions include only the translated text (with original formula text where applicable), a completion warning when needed, PLaMo attribution, a Japanese/English training-use notice, and the official license links. They do not include the separate source-text field.
The notice can be previewed before copying or saving. Nothing is sent automatically.
If you use ordinary copy or another sharing method, provide the required notice separately in a way recipients can recognize. For long-form publications, place the attribution appropriately in the publication as well.
The helper text addresses these notice and attribution requirements; it does not replace the full agreement or grant rights in third-party source material.

## 3. Third-party software notices

The following notices accompany components used in the packaged extension and its inference runtime.
Each linked file preserves the upstream copyright and license text; those texts govern the corresponding material.

| Component                                                                                    | Copyright / attribution                                                         | License or notice                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PDF.js 6.5.438                                                                               | Mozilla Foundation and PDF.js contributors                                      | [Apache 2.0](../vendor/licenses/pdfjs.txt); bundled CMap, font, codec and color-management notices accompany the assets |
| wllama 3.8.1                                                                                 | © 2024 Xuan Son NGUYEN                                                          | [MIT](../vendor/licenses/wllama.txt)                                                                                    |
| llama.cpp / ggml                                                                             | © 2023–2026 The ggml authors                                                    | [MIT](../vendor/runtime/llama-LICENSE)                                                                                  |
| hash-wasm 4.12.0                                                                             | © 2020 Dani Biró                                                                | [MIT and upstream notices](../vendor/licenses/hash-wasm.txt)                                                            |
| SHA-256 implementation used by hash-wasm                                                     | © 2010 Aleksey Kravchenko; modified by Dani Biró                                | [Permissive license and disclaimer](../vendor/licenses/hash-wasm-sha256.txt)                                            |
| Emscripten runtime support                                                                   | Emscripten authors and identified contributors                                  | [MIT / University of Illinois-NCSA and included notices](../vendor/licenses/emscripten.txt)                             |
| musl C library                                                                               | © 2005–2020 Rich Felker and contributors; additional attributions in the notice | [MIT and component notices](../vendor/licenses/musl.txt)                                                                |
| Dawn WebGPU C++ bindings                                                                     | The Dawn & Tint Authors                                                         | [BSD 3-Clause](../vendor/licenses/dawn.txt)                                                                             |
| Emscripten WebGPU support distributed with Dawn                                              | Emscripten authors                                                              | [MIT / University of Illinois-NCSA](../vendor/licenses/emdawnwebgpu.txt)                                                |
| Embedded llama.cpp libraries: JSON for Modern C++, stb_image, miniaudio, SHA-256, and xxHash | Authors identified in the component notices                                     | [MIT, BSD, public-domain and alternative terms](../vendor/licenses/llama-components.txt)                                |
| LLVM libc++, libc++abi, and compiler-rt                                                      | LLVM Project contributors and identified authors                                | [Apache 2.0 with LLVM Exceptions and retained notices](../vendor/licenses/llvm-runtime.txt)                             |
| musl component-specific notices                                                              | Sun Microsystems, Arm Limited, and other identified authors                     | [Additional source notices](../vendor/licenses/musl-components.txt)                                                     |

The build modifies PDF.js 6.5.438 to export the embedded Type1/CFF glyph names and their Unicode values with font metadata.
The patch in `scripts/pdf-worker.mjs` reuses the upstream font parser and glyph-name mapping, preserves the original rendering paths, and fails the build if its insertion points change.
The generated worker includes a modification notice and retains the upstream license notice.
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
