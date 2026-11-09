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

## PDF selections

Glosside translates text selected in Chrome's standard PDF viewer.
The viewer continues to handle navigation, search, zoom, printing, and saving.
The native popup can preserve display and inline equations as images while translating surrounding prose. Inline detection uses font and baseline information. Matching uses the complete range when possible, then unique prose anchors and local formula comparisons when extraction order differs. Symbol encodings and embedded Type1/CFF glyph names are read from the PDF font itself; geometric checks handle overlaid accents and reordered tall operators. Approximate alignment locates local boundaries; formula glyphs are then checked separately against the source and the PDF font mapping. A single replacement character at a selection edge can be recovered only as a complete supplementary Unicode glyph located by adjacent prose anchors; replacement characters inside a formula are not treated as wildcards. Complete matches take precedence over similar but contradictory passages. It supports two-column selections, short variables, and inline formulas wrapped across lines. Numbered algorithm steps are translated separately, with their line numbers retained. Formula glyphs are rendered with their original PDF outlines while adjacent prose is excluded. Selecting nearby prose helps establish a unique location; equation-only selections can remain unresolved. PDF.js is bundled locally; the current PDF is retrieved again using the site's granted access, with credentials omitted and redirects refused.
Repeated passages are accepted only when every candidate has the same glyphs, fonts, relative geometry, and rendered appearance. Unmatched or ambiguous ranges, unsupported fonts or layouts, and unavailable PDFs retain their original text. A formula that cannot be rendered remains as source text while the surrounding matched prose can still be translated. Preparation is bounded to a 24 MiB PDF, 100 pages, 96 equation images, 512 KiB of encoded images, and a 20-second deadline. Equations exceeding the image budget remain as source text; document or time limits can cause the whole selection to fall back to source text.
Neutral equation ink blends with the popup text color, with increased antialias coverage for thin strokes while retaining transparent gaps; colored glyphs retain their PDF colors, including a separate variant for forced-colors mode. Inline images follow the surrounding text baseline; long display equations scroll horizontally. Inline passages are translated together using opaque identifiers, then restored only if each identifier appears exactly once. Missing, duplicate, or unknown identifiers retain the affected passage, while subsequent independent passages can still be translated. The copy action includes the equation's original extracted text. This image-preservation path is for the native popup, not text pasted into the side panel.
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
