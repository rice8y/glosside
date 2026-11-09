# Supported Environments and Limitations

Last updated: November 10, 2026

## Requirements

- Desktop Chrome 151 or later. Native PDF integration has been tested on macOS with Chrome for Testing 156 and 157; other operating systems, Chromium browsers, and mobile browsers have not been verified.
- About 573 MB for the model, plus temporary download storage and working memory. Performance depends on the device and processing backend.

## Web pages

Selection and whole-page translation require access to the HTTP(S) page or frame.
Open Glosside from the toolbar to activate a page, or grant website access in settings.
Browser-restricted pages, canvas content, closed shadow roots, and custom editors are outside general automatic extraction support.
Password fields are excluded from extraction.

Whole-page translation processes up to 2,000 text nodes, preserving surrounding elements and leaving input fields, code, and equations in place.
Text split across elements may translate less fluently.
Hover over translated text to see the original, or choose **Restore original**; subsequent website edits take precedence.
Whole-page translation is unavailable when **Show translations only in the side panel** is enabled.

Selection popups preserve the following structure, but not the page’s complete styling:

| Content | Supported behavior |
| --- | --- |
| Paragraphs and lists | Preserve block boundaries, explicit line breaks, bullets, and numbering. Markerless containers such as chat message lists remain paragraphs. |
| HTML tables | Preserve rows, columns, headers, and merged cells. Unselected cells remain blank; wide tables scroll horizontally. |
| Code | Keep selected code, filenames, and preformatted text unchanged. |
| Equations | Preserve MathML, MathJax, KaTeX, and explicitly marked equation images. Inline formulas stay with their sentence; display equations remain separate. |

If structured extraction disagrees with the browser’s selection, the popup falls back to the selected text.
Unsupported equations use available source text or labels; unmarked images, canvas equations, and plain-text TeX are not automatically recognized.
Ambiguous formula placement or more than 96 formulas retains the source.
Copying uses text, including list markers, tab-separated table cells, and available equation text—not equation images.
These features do not reconstruct structure from text pasted into a text field.

## Text translation

The toolbar popup accepts text independently of website permissions.
**Open in a tab** transfers the input and available result to the larger workspace.

Closing the popup stops its active translation.
Its input and completed result remain as a single draft until **Clear text** or browser-session end; incognito uses a separate draft.
There is no persistent translation history.

## PDF selections

Text selection translation works in Chrome’s standard PDF viewer; whole-document translation and OCR are not supported.
Embedded or alternative viewers may behave differently, and Chrome updates can affect integration.

The native popup can preserve equations as images and reconstruct complete tagged or ruled tables, including supported academic tables.
Select the entire table; nearby prose can help locate equations.
When table cells cannot be reliably separated, the original table may appear as an image.
Ambiguous selections, unsupported layouts, scanned content, or unavailable PDFs fall back to extracted source text.
Untagged tables without rules are not reconstructed.

Structured PDF processing retrieves the PDF again using granted website access, without credentials or redirects.
It is limited to 24 MiB, 100 pages, and 20 seconds; equation and table images share a 512 KiB budget.
Selections support up to 96 equation images and tables totaling 256 cells, with at most 40 rows and 12 columns per table.
Exceeding these limits can retain some or all source text.
Copying includes extracted equation text and tab-separated table cells.

Positioning controls near an HTTP(S) PDF selection uses the debugger permission and triggers Chrome’s debugging notification.
Keyboard selection or unavailable positioning uses the upper-right corner.
Scrolling dismisses unpinned results.

For local `file://` PDFs or unavailable inline controls, try **Translate selected text** from the context menu or paste text into the side panel.
Local files also require Chrome’s extension file-access setting.

## Translation limits

Long input is segmented rather than silently truncated; excessive context or glossary input produces an error.
Interrupted or token-limited output is marked incomplete.
Completion means generation finished, not that the translation is accurate.
Review translations before relying on or publishing them.

The [PLaMo license](../vendor/plamo-en.txt) applies, including restrictions on using outputs as the sole basis for legal, medical, financial, or important personal assessments.
See also [license notices](license-notices.md) and the [privacy policy](privacy-policy.md).
