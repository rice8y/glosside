# Privacy Policy

Last updated: November 10, 2026

## 1. Publisher and scope

Eito Yoneyama publishes Glosside, a Chrome extension for on-device translation.
This policy describes the information handled by Glosside and the choices available to its users.
The project repository is [rice8y/glosside](https://github.com/rice8y/glosside).
The repository version of this policy is [docs/privacy-policy.md](https://github.com/rice8y/glosside/blob/main/docs/privacy-policy.md).

## 2. Information processed on your device

Glosside processes text you select, enter in the side panel, or request to translate on a web page, together with any context and glossary terms supplied for that translation.
Translation runs on your device.
Glosside does not send this content or the resulting translations to the publisher or to a translation service.
It does not include advertising, analytics, or automatic telemetry.

On permitted pages, Glosside accesses the displayed document and selection to provide translation controls and extract text.
It uses tab identifiers, frame information, URLs, and website permission patterns to route requests and enforce site access.
It does not maintain a browsing-history database.
For web-page equations, Glosside reads the selected DOM and keeps a temporary, inert representation in the translation popup. Formula markers are processed locally. Preserving an equation image can cause the browser to load its existing image URL again, subject to normal browser caching; no selection, translation, or glossary text is added to that request. The popup omits referrer information for these image requests.

PDFs remain displayed in Chrome's viewer. For selections in the native PDF popup, Glosside may retrieve the current PDF URL again using the site's granted access to locate and render display and inline equations locally. Inline equations are represented by temporary identifiers during local translation; the equation images and PDF bytes are not sent to a translation service.
This temporary copy and its parsed text are held in memory during preparation, not written to extension file storage. Extracted equation images remain with the displayed result until it is closed or replaced.

The publisher does not receive or review locally processed content through the extension.
Glosside does not sell user data, use it for advertising, or send it for model training.
Information accessed through Chrome APIs is used only to provide the extension's translation features, consistent with the [Chrome Web Store Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

## 3. Local storage and retention

| Information                                                      | Purpose and storage                                                                                                                        | Retention and removal                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings and model-license consent                               | Saved in the extension's local storage to preserve your choices                                                                            | Kept until changed, reset, or removed with the extension                                                                                                                         |
| Glossary names, descriptions, source terms, and translated terms | Saved in local storage for reuse in translation                                                                                            | Kept until edited or deleted in Glossaries, reset with settings, or removed with the extension                                                                                   |
| Saved website permission patterns                                | Saved in local storage to manage enabled websites                                                                                          | Remove site access in settings; resetting translation settings does not revoke website permissions                                                                               |
| Model weights and incomplete downloads                           | Saved in browser-managed extension file storage for local inference and resumable downloads                                                | Kept until deleted using the model controls or removed with the extension                                                                                                        |
| Active translation text and results                              | Held in memory for processing and display; no persistent translation-history database                                                      | Released as the relevant UI or inference session ends; clearing the result cache does not clear text still displayed in an open page or panel                                    |
| Translation result cache                                         | Held in memory and scoped to the requesting client/document                                                                                | Entries expire after ten minutes and are removed by periodic cleanup; they can be evicted earlier, cleared in settings, or removed when the client connection expires            |
| Popup text draft | The latest input, completed or explicitly stopped output, and editor language/glossary choices are kept in browser-session storage; regular and incognito drafts use separate keys | Removed by **Clear text** or when the browser session ends; not synced and not a translation-history database |
| Context-menu selection                                           | Temporarily placed in browser-session storage for delivery to the side panel                                                               | Eligible for delivery for two minutes; removed after consumption or replaced by the next selection. Unconsumed text can remain in session storage until the browser session ends |
| PDF positioning state                                            | Pointer coordinates and viewport information in memory; per-tab cancellation flags in session storage                                      | Tracking state ends when detached; cancellation flags are removed on explicit reactivation, tab closure, or session end                                                          |
| PDF equation preparation and images                              | A temporary PDF copy and parsed text in memory; equation images in the result UI                                                           | Parser resources are released after preparation or cancellation; images are released when the popup closes or is replaced                                                        |
| Device optimization profile                                      | Local processing settings, sample timings, model/runtime identifiers, user-agent string, reported CPU core count, and isolation capability | Kept until replaced, reset with settings, or removed with the extension                                                                                                          |

Device optimization uses built-in sample text, not page content.
Glosside uses local storage rather than Chrome's synchronized storage.
If you enable the extension in incognito mode, inference sessions are separate, but saved extension settings and glossaries should not be treated as temporary incognito data.

## 4. Network connections and external services

After you accept the model license and start a download, Glosside requests the model over HTTPS from Hugging Face (`huggingface.co`) and its delivery hosts under `hf.co`.
These services receive connection information such as your IP address, the requested model resource, request timing, and browser-supplied HTTP headers.
The download request omits credentials and referrer information and contains no translation text or glossary content.
Downloaded weights are checked against the expected SHA-256 hash before use.
The provider's handling of connection data is described in the [Hugging Face Privacy Policy](https://huggingface.co/privacy).

For equation preservation in the native PDF popup, Glosside can make an additional GET request to the current HTTP(S) PDF URL. That website receives ordinary connection information and the requested URL, which may itself contain identifiers or access tokens. The request omits cookies, other browser credentials, and referrer information, follows no redirects, and includes no selection, translation, or glossary text. The PDF is parsed and rendered on your device. If access, alignment, or rendering fails, the affected part remains as original text. Chrome's normal HTTP caching may apply separately from extension storage.

Opening external links, including the project repository, license pages, and support issues, connects your browser to those services.
Their own privacy policies apply to those visits.
Website traffic and Chrome's own services operate separately from Glosside's translation processing.

## 5. Permissions and visibility to websites

Glosside uses temporary access granted through the extension icon or optional website access to provide translation on the pages you authorize.
It uses extension storage and background processing for settings, model files, and local inference, and the context-menu and side-panel permissions for those interfaces.

The debugger permission supports positioning controls near mouse selections in Chrome's PDF viewer.
This permission is broader than that specific use: Chrome grants debugging capabilities, and shows a notification while a tab is attached.
Glosside limits its attachment to enabled, visible HTTP(S) PDF tabs and uses isolated observers for pointer positions and selection or viewport events.
It does not use this feature to record typed text, capture screenshots, intercept network responses, or modify PDF files.

Disable native PDF positioning in settings to stop this use of the debugger.
You can also cancel Chrome's debugging notification; Glosside remembers that cancellation for the tab until explicit reactivation.
Hiding or navigating away from the PDF, revoking site access, or enabling panel-only mode stops positioning.
Disabling the feature does not remove the debugger permission from the installed extension.

Translations displayed within a web page may be readable by that page's scripts.
For content you do not want to display on a page, enable **Show translations only in the side panel** and use the context menu or manual input.

## 6. Exports, diagnostics, and deletion

Copying a translation places it on the system clipboard.
Ordinary text export saves a file containing the source and translated text.
The optional **Copy with notice** and **Save with notice** actions include the translation and a PLaMo attribution/training-use notice, without the separate source-text field. Formula text retained within the translation is included. These actions do not automatically send anything to another person or service.
These user-created copies remain outside extension storage; deleting extension data does not delete files or clipboard contents.

Diagnostic export is manual and creates a local JSON file.
It includes the extension version, export time, model and runtime identifiers, runtime state and error code, processing backend, CPU core count, cache counters, summarized performance timings, and any saved device optimization profiles.
It excludes translation text, glossary entries, document names, document URLs, and source-content hashes.
Diagnostic measurements use at most the latest 64 numeric samples per stage in memory.
Nothing is automatically uploaded; review an exported file before choosing to share it.

Use settings to clear the translation cache, delete the model and partial downloads, or reset settings and glossaries.
Manage website permissions separately under site access.
Removing the extension removes its browser-managed extension data, but not files you exported or copies retained in your backups.
Glosside does not add its own encryption to local storage; protection depends on the browser, operating system, and device access controls.

## 7. Contact and changes

For questions about this policy or the extension's data handling, contact Eito Yoneyama through [GitHub Issues](https://github.com/rice8y/glosside/issues).
Issues are public: do not include confidential text, personal documents, or other sensitive information.
Information you choose to post is handled by GitHub and is visible to the publisher and other readers under [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
The publisher cannot retrieve content that remains solely on your device.

Policy updates will be published in this repository and included with the corresponding extension version, with a revised date above.
