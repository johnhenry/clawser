# Firefox Compatibility

## Overview

Clawser ships a Chrome Manifest V3 extension by default. For Firefox, a
Manifest V2 manifest is provided in `extension/firefox/manifest.json`.
Firefox is transitioning to MV3 but still requires MV2 for full compatibility
with background scripts and certain API surfaces.

## Differences from Chrome

| Feature              | Chrome (MV3)              | Firefox (MV2)                    |
|----------------------|---------------------------|----------------------------------|
| Manifest version     | 3                         | 2                                |
| Background           | `service_worker`          | `scripts` array (event page)     |
| Host permissions     | Top-level field           | Listed in `permissions`          |
| `chrome.userScripts` | Available (Chrome 135+)   | Not available                    |
| `chrome.scripting`   | Full support              | Partial — `executeScript` works  |
| Cookies API          | Same                      | Same                             |
| WebRequest           | Limited (declarativeNet)  | Full blocking support            |

## Installation

### Firefox (Developer Edition / Nightly)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Navigate to `extension/firefox/` and select `manifest.json`
4. Open Clawser at `http://localhost:...` — the content script injects automatically

### Firefox (Signed / AMO)

Publishing to AMO requires:
- Rename `applications` to `browser_specific_settings` for Firefox 48+
- Submit the `extension/firefox/` directory as a ZIP
- Replace `background.js` references to `chrome.*` with `browser.*` or use
  the WebExtension polyfill

## API Compatibility Notes

### `chrome` vs `browser` namespace

Firefox supports both `chrome.*` (callback-based) and `browser.*`
(Promise-based). The current `background.js` uses `chrome.*` which works
in Firefox with automatic Promise wrapping for most APIs.

For full compatibility, consider adding the
[webextension-polyfill](https://github.com/nicolo-ribaudo/webextension-polyfill):

```html
<script src="browser-polyfill.min.js"></script>
```

### Missing APIs in Firefox

- `chrome.userScripts` — not available. DOM reading falls back to
  `chrome.scripting.executeScript` in the ISOLATED world.
- `chrome.tabs.captureVisibleTab` — works but requires `<all_urls>` in
  permissions (already included).
- `chrome.debugger` — not available in Firefox. The optional `debugger`
  permission in Chrome MV3 has no Firefox equivalent.

### Content Security Policy

Firefox MV2 allows inline scripts by default. No CSP changes needed for
the content script relay.

## Shared Files

The following files are identical between Chrome and Firefox builds:
- `background.js`
- `content.js`
- `icons/`

Only `manifest.json` differs. A build script can copy shared files into
the Firefox directory before packaging:

```bash
cp extension/background.js extension/firefox/
cp extension/content.js extension/firefox/
cp -r extension/icons extension/firefox/
cd extension/firefox && zip -r ../clawser-firefox.zip .
```
