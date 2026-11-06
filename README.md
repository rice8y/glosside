# Glosside

Translate selected text, web pages, and PDF selections locally in Chrome with PLaMo 3 Translate 0.8B.

## Installation

Requires desktop Chrome 151+ and Node.js 22+ to build.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/`.
3. Open Glosside's settings, review the model license, and download the model (about 573 MB).

After updating, reload the extension and the pages you want to translate.

## Useage

Click the extension icon to activate the current page, select text, and click the translation button. Use **Translate this page** for whole-page translation, or the side panel for manual input. Whole-page translation is unavailable in panel-only mode.

Page translation replaces the displayed text. Hover over a translated passage to see its original, or choose **Restore original** to restore the page.

PDF selection translation uses Chrome's standard viewer. Positioning the popup near a PDF selection uses the debugger permission and displays Chrome's debugging notification. Disable native PDF positioning in settings to use the upper-right corner instead. PDF document translation and OCR are not supported.

See [supported environments and limitations](docs/supported-environments.md).

## Privacy

Source text and translations are not sent to a translation server. See the [privacy policy](docs/privacy-policy.md) for details.

## License

Glosside's own code is licensed under the [MIT License](LICENSE). See [third-party notices](docs/license-notices.md) for dependency licenses.

Built with PLaMo. The model and its outputs are covered by the [PLaMo Community License](vendor/plamo-en.txt).
