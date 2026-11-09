# Supported Environments and Limitations

Last updated: November 7, 2026

## Browser and device requirements

Glosside requires desktop Chrome 151 or later.
Building from source requires Node.js 22 or later.
The model download is approximately 573 MB; additional storage is required during download verification, and inference requires available system memory beyond the model file size.
Performance depends on the device, available memory, and selected processing backend.

Native PDF integration has been exercised with Chrome for Testing 156 and 157 on macOS.
The minimum browser version is an installation requirement, not a claim that every browser version or operating system has been tested.
Other Chromium browsers, mobile browsers, and other operating systems have not been verified.

## Web pages

Selection and whole-page translation operate in permitted HTTP(S) frames.
Activate a page through the extension icon, or grant website access in settings.
Whole-page translation is unavailable when **Show translations only in the side panel** is enabled.

Extraction uses the displayed DOM and selection ranges.
Whole-page translation replaces up to 2,000 text nodes while preserving their surrounding elements, including links, form values, and event handlers.
Each node is translated separately, with surrounding original text supplied as context when it fits; sentences split across inline elements can be less fluent than a continuous passage.
Hover over translated text to see the original, or use **Restore original** to restore unchanged translated nodes.
If the website updates a passage, its new content takes precedence over the saved original.
Complex page scripts can still affect extraction or presentation.
Canvas content, closed shadow roots, custom editors, and browser-restricted pages are outside general automatic extraction support.
Input fields are excluded from automatic page translation; password fields are excluded from extraction.

## Paragraphs and line breaks in selection popups

Selection and paragraph popups retain visible HTML block boundaries, including paragraphs, headings, nested block containers, and CSS block layouts. Text is translated within each block, so equations cannot move to another paragraph. Adjacent selected paragraphs provide bounded context for sentences that lead into an equation, without changing their output positions. Explicit display equations and code blocks keep their positions between surrounding prose. An independent equation row built from inline formulas stays in its own paragraph without site-specific detection. Inline and `display: contents` wrappers do not split sentences.

Whitespace follows the source CSS: normal HTML formatting whitespace is collapsed, while explicit `<br>` and preserved line breaks are restored independently of translation. Model-generated line breaks do not add paragraph spacing. Long equations can scroll within their paragraph. This preserves text structure, not the page’s complete styling or arbitrary layout.

## Lists in selection popups

Unordered, ordered, and nested HTML lists retain their items in the translated popup, including when the list contains equations. Each paragraph or item is translated separately. Ordered lists retain their starting number, explicit item values, reversed order, and HTML numbering type. Selecting only part of a list keeps the selected items at their original numbers. Copying includes bullet or numeric markers. The popup exposes native list and list-item semantics to accessibility tools.

## Tables in selection popups

HTML tables retain rows, columns, header cells, captions, row groups, and merged cells in the translated popup. Paragraphs in each selected cell are translated separately; lists and equations inside cells remain structured. Partial selections leave unselected cells blank to retain column positions. Wide tables scroll horizontally inside the popup and can be focused for keyboard scrolling. Copying uses tabs between columns and newlines between rows. Native table semantics remain available to accessibility tools. This applies to HTML tables, not tables drawn in images or canvas. PDF table support is described below.

## Literal code in selection popups

Visible `code`, `pre`, `kbd`, and `samp` content is retained as literal text, including filenames in table cells. Only selected text is kept; syntax-highlighting markup and executable attributes are not copied. Code-only cells bypass inference. Code embedded in prose is protected while the surrounding sentence is translated, and an invalid marker mapping retains the original passage. Multiline code preserves whitespace and scrolls horizontally when needed. Copying includes the literal source text. Whole-page translation continues to leave code and preformatted blocks in place.

## Equations on web pages

Selection and paragraph popups preserve MathML, MathJax (HTML or SVG), KaTeX, and images explicitly marked as equations. Inline formulas stay within the translated sentence; display equations remain separate and can scroll horizontally. A selection crossing part of a formula includes the complete formula. Visual output and accessibility MathML are treated as one equation. This includes accessibility copies stored beside the visible MathJax output. Native MathML exposes one structured equation in the accessibility tree; visual-only copies use one labelled math object.

MathML is rendered natively when available. Otherwise, the popup uses an inert copy of the rendered SVG or HTML, or the original equation image. Scripts, event handlers, links, and external SVG references are not copied. Unsupported or not-yet-rendered visual output falls back to the formula's source text or label. Copying a translation includes available TeX, a textual MathML representation, or image alternative text; formulas without textual metadata use an equation label. Images are preserved without OCR. Unmarked images, canvas equations, and arbitrary TeX in plain text are not detected as equations.

Whole-page translation leaves the original equation elements in place. Ordinary paragraphs with suitable text nodes are translated as a sentence around the equations. Rich markup retains per-node translation with the mathematical paragraph as context. Results that would move formulas or require new text positions remain unchanged. Restoring the page preserves its original elements and respects updates made by the website.

Formula markers must survive translation exactly once each. Missing, repeated, or unknown markers retain the original selection or passage. Selections containing more than 96 formulas retain the source. These features use the page DOM and apply to in-page controls, not plain text pasted into the side panel. Editing the surrounding source retains formulas when their textual representations remain unambiguous.

## PDF selections

Glosside translates text selected in Chrome's standard PDF viewer.
The viewer continues to handle navigation, search, zoom, printing, and saving.
The native popup can preserve display and inline equations as images while translating surrounding prose. Inline detection uses font and baseline information. Matching uses the complete range when possible, then unique prose anchors and local formula comparisons when extraction order differs. Symbol encodings and embedded Type1/CFF glyph names are read from the PDF font itself; geometric checks handle overlaid accents and reordered tall operators. Approximate alignment locates local boundaries; formula glyphs are then checked separately against the source and the PDF font mapping. A single replacement character at a selection edge can be recovered only as a complete supplementary Unicode glyph located by adjacent prose anchors; replacement characters inside a formula are not treated as wildcards. Complete matches take precedence over similar but contradictory passages. It supports two-column selections, short variables, and inline formulas wrapped across lines. Numbered algorithm steps are translated separately, with their line numbers retained. Formula glyphs are rendered with their original PDF outlines while adjacent prose is excluded. Selecting nearby prose helps establish a unique location; equation-only selections can remain unresolved. PDF.js is bundled locally; the current PDF is retrieved again using the site's granted access, with credentials omitted and redirects refused.
Repeated passages are accepted only when every candidate has the same glyphs, fonts, relative geometry, and rendered appearance. Unmatched or ambiguous ranges, unsupported fonts or layouts, and unavailable PDFs retain their original text. A formula that cannot be rendered remains as source text while the surrounding matched prose can still be translated. Preparation is bounded to a 24 MiB PDF, 100 pages, 96 equation images, 512 KiB of encoded images, and a 20-second deadline. Equations exceeding the image budget remain as source text; document or time limits can cause the whole selection to fall back to source text.
Neutral equation ink blends with the popup text color, with increased antialias coverage for thin strokes while retaining transparent gaps; colored glyphs retain their PDF colors, including a separate variant for forced-colors mode. Inline images follow the surrounding text baseline; long display equations scroll horizontally. Inline passages are translated together using opaque identifiers, then restored only if each identifier appears exactly once. Missing, duplicate, or unknown identifiers retain the affected passage, while subsequent independent passages can still be translated. The copy action includes the equation's original extracted text. This image-preservation path is for the native popup, not text pasted into the side panel.
Native PDF selections can also retain complete rectangular tables: tagged `Table`/`TR`/`TH`/`TD` structures, or closed grids of straight stroked rules with text fully inside each cell. Header cells from PDF tags and empty cells are retained. Each text cell is translated separately; cells containing numbers or possible mathematical notation remain literal. Wide tables scroll horizontally, and copying uses tabs between columns and newlines between rows. The selected text must match the complete table without changing character order (apart from whitespace and Unicode normalization). Detected partial tables, merged cells, missing cross-page tag content, ambiguous repeated tables, and text crossing cell borders retain the original selection with a warning. Tables are limited to 40 rows, 12 columns, and 256 cells across a selection. Untagged borderless tables, filled rather than stroked rules, scanned tables, and other unrecognized layouts are not reconstructed.
Whole-document PDF translation and optical character recognition (OCR) are not supported.
If the viewer cannot provide selectable text, enter text in the side panel.

On enabled HTTP(S) PDF tabs, native PDF positioning places translation controls near the mouse-release position.
This uses the debugger permission and triggers Chrome's debugging notification.
Keyboard selections, disabled positioning, or unavailable tracking use the upper-right corner.
Scrolling or changing the layout dismisses an unpinned result; select again to place it.

PDF selection integration depends partly on Chrome's internal viewer messaging and can change between browser versions.
Embedded or alternative viewers may behave differently.
For local `file://` PDFs or unavailable inline controls, try **Translate selected text** from the context menu, or paste text into the side panel.
Local file access is also subject to Chrome's extension settings.

## Translation limits and review

Long input is split into segments rather than silently truncated.
Context or glossary input that exceeds the available input budget produces an error.
Interrupted or token-limited generation is shown as incomplete.
A completed translation indicates that generation finished; it does not establish accuracy or completeness of meaning.

Review translations before relying on or publishing them.
The model can omit information, change meaning, or produce incorrect text.
The [PLaMo license](../vendor/plamo-en.txt), including its restrictions on using outputs as the sole basis for legal, medical, financial, or important personal assessments, applies to model use.
See [license notices](license-notices.md) and the [privacy policy](privacy-policy.md) for further details.
