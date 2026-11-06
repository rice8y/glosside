# Glosside

Translate selected text, web pages, and PDF selections locally in Chrome with PLaMo 3 Translate 0.8B.

## Installation

Requires desktop Chrome 151 or later.

### From Releases

Download and install the latest release without Node.js or build tools.

**macOS / Linux**

```sh
curl -fsSL https://github.com/rice8y/glosside/releases/latest/download/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://github.com/rice8y/glosside/releases/latest/download/install.ps1 | iex
```

The installer detects the platform, verifies the ZIP's SHA-256 checksum, and extracts it to:

| Platform | Default directory                                     |
| -------- | ----------------------------------------------------- |
| macOS    | `~/Library/Application Support/Glosside/extension`    |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/glosside/extension` |
| Windows  | `%LOCALAPPDATA%\Glosside\extension`                   |

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the directory printed by the installer.
3. Open Glosside's settings, review the model license, and download the model (about 573 MB).

To update, run the installer again, click **Reload** on Glosside in `chrome://extensions`, and reload your open pages. Keep the installation directory in place while using the extension.

You can also [download the ZIP directly](https://github.com/rice8y/glosside/releases/latest/download/glosside-chrome.zip), extract it, and load its `glosside` folder manually. The ZIP is shared across platforms; model weights are downloaded separately.

### From Source

Requires Node.js 22 or later.

```sh
git clone https://github.com/rice8y/glosside.git
cd glosside
npm ci
npm run build
```

Load `dist/` from `chrome://extensions` using **Load unpacked**, then download the model in Glosside's settings. After rebuilding, reload the extension and your open pages.

## Usage

Click the extension icon to activate the current page, select text, and click the translation button. Use **Translate this page** for whole-page translation, or the side panel for manual input. Whole-page translation is unavailable in panel-only mode.

Page translation replaces the displayed text. Hover over a translated passage to see its original, or choose **Restore original** to restore the page.

PDF selection translation uses Chrome's standard viewer. Positioning the popup near a PDF selection uses the debugger permission and displays Chrome's debugging notification. Disable native PDF positioning in settings to use the upper-right corner instead. PDF document translation and OCR are not supported.

See [supported environments and limitations](docs/supported-environments.md).

## Privacy

Source text and translations are not sent to a translation server. See the [privacy policy](docs/privacy-policy.md) for details.

## License

Glosside's own code is licensed under the [MIT License](LICENSE). See [third-party notices](docs/license-notices.md) for dependency licenses.

Built with PLaMo. The model and its outputs are covered by the [PLaMo Community License](vendor/plamo-en.txt).
