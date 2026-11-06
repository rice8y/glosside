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
