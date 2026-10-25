# WoW-Deck

A Windows 11 Stream Deck plugin that mirrors a rectangular grid of pixels from a selected window onto Stream Deck keys. Select any application, such as Notepad, for testing; select WoW Forever for use with the game. Each **WoW Action Bar Button** can send its own shortcut while the selected window is foreground. The grid is arbitrary: arrange the game UI to match it. There is no game addon, OCR, spell detection, or service.

The display name is **WoW-Deck**. The plugin UUID is `com.wow-deck` and its action UUID is `com.wow-deck.button`; Elgato's validator rejects the bare `wow-deck` identifier because plugin UUIDs require reverse-DNS form.

## Prerequisites and install

- Windows 11 x64, Stream Deck 7.1 or newer, and the original 15-key Stream Deck. Other key-based Stream Decks can also host the action; the default layout is intended for 5×3.
- The manifest declares Windows minimum version `10` because Windows 11 reports OS version `10.0`; this avoids a false "more recent operating system" installer error. The target platform is Windows 11.
- Node.js 24 for development. A release build includes the Windows x64 native packages and uses Stream Deck's Node 24 runtime.
- A target application running in a window or borderless window. The Windows Graphics Capture API and MSVC runtime must be available.

```powershell
npm install
npm run format:check
npm run typecheck
npm test
npm run build
npm run validate
npm run link
npm run restart
```

`npm run link` links the generated `com.wow-deck.sdPlugin` folder into Stream Deck. To make a distributable installer, run `npm run pack` and open the `.streamDeckPlugin` file in `dist`. The Elgato CLI may need developer mode enabled (`npx streamdeck dev`). It requires Node 24. The generated plugin folder contains all Windows x64 runtime binaries; do not copy just `bin/plugin.js`.

## Setup

1. Add **WoW Action Bar Button** to any key. Open its Property Inspector.
2. Under **Shared Grid Settings**, select any visible top-level window, including Notepad or a browser for testing. Click **Refresh window list** if it opened after the inspector. If the list is empty, click **Pick active window in 3 seconds** and switch to the target application before the countdown ends. You can also type an executable name (for example `notepad.exe`) and/or part of a window title, then save the shared grid. The picker uses Windows window enumeration independently of screen capture. A dropdown choice uses the window handle for exact selection while it exists, then falls back to executable and title after restart. A title-only target matches visible windows by substring. Some protected processes may appear with a `pid-...` label and will need reselection after restart. Manual matching still requires an accessible desktop window.
3. Enter `originX`, `originY`, cell width/height, gaps, rows, and columns, then save. These are **physical pixels relative to the top left of the selected window's client area**, excluding the title bar. At 125% Windows scaling, use actual captured pixel distances, not unscaled UI units. The plugin requests per-monitor DPI awareness before querying the window. If another component already fixed process DPI awareness or a display mode changes, recalibrate and verify the crop.
4. For each button, choose **Action Bar Position**, such as `2-3`, and enter its **Keyboard Shortcut**. Button changes save automatically; the Inspector confirms **Button settings saved** after Stream Deck returns the stored values. The button itself has no coordinate fields. A blank shortcut mirrors only. **Mirror Image** can be switched off per button.

The default 3×5 reference grid is:

```text
1-1   1-2   1-3   1-4   1-5
2-1   2-2   2-3   2-4   2-5
3-1   3-2   3-3   3-4   3-5
```

Suggested editable shortcuts in row order: `1 2 3 4 5`, `6 7 8 9 0`, `- = Shift+1 Shift+2 Shift+3`. The physical key location is deliberately not used for automatic assignment; actions may be moved, duplicated, or placed on multiple devices. **All connected Stream Decks on this computer share one grid and one capture session**, while every button retains its own cell, shortcut, and mirror setting. Assigning the same cell to two buttons is supported.

Shortcuts support one main key (`A`–`Z`, `0`–`9`, `F1`–`F12`, `-`, `=`, arrows, Space, Enter, Tab, Esc) and optional Ctrl, Alt, Shift. Click **Learn shortcut** and press the desired combination, or type it with plus or hyphen separators, for example `Ctrl+Alt+Shift+F1` or `Ctrl-Alt-Shift-F1`. OS-reserved combinations may not reach the inspector. They use Win32 virtual keys and the active Windows keyboard layout. The plugin sends key-down on press and key-up on release, with modifiers in order. It never activates or focuses the selected window on your behalf. If another app is foreground when a key is pressed, it sends nothing. User-level `SendInput` cannot promise that a game accepts synthetic input; some games reject it. If that happens, use Stream Deck's built-in Hotkey action on a separate key for input and keep this action for images.

## Window capture limits and troubleshooting

Capture uses one Windows Graphics Capture session for the selected window. It can work in normal windowed and borderless fullscreen modes. Minimized windows, exclusive fullscreen, protected or inaccessible windows, a disabled capture service, or Windows capture permissions may block frames. Windows may draw a capture border or require permission depending on system settings. Occlusion behavior depends on the Windows capture implementation. The plugin does not elevate, inject into, or read memory from the game.

The selected window is identified by executable name and/or title and re-discovered after restart when possible. Move or resize it freely, but verify grid coordinates when the client area resolution changes. If the plugin says **Client area unavailable**, the Win32 client rectangle does not fit the capture frame; check display scaling and window mode. Out-of-bounds or removed positions show **Invalid cell**. With no selected/running window, minimized window, or failed capture, keys show a visible fallback. Native module loading errors show **Module error** and are written to the plugin log.

On Windows, the plugin log is at `%APPDATA%\Elgato\StreamDeck\Plugins\com.wow-deck.sdPlugin\logs\com.wow-deck.0.log`. The Stream Deck application log is at `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.log` on current installations; older versions use `StreamDeck0.log`. If the plugin crashes before its logger starts, the plugin log may not exist, but the application log will show `com.wow-deck` terminating. Open these paths in File Explorer by pasting them into its address bar. Reinstalling removes plugin logs, so copy them first if reporting an issue.

The capture API returns a whole window frame. The plugin processes that frame once per configured interval (250, 500, 1000, or 2000 ms), crops each unique selected cell once, and skips PNG encoding when the raw crop is unchanged. It sends a 144×144 PNG to Stream Deck only when the result changes. Non-square cells are scaled to fit on a dark square without stretching. Native capture frames and sessions are released on action removal, window loss, and shutdown.

## Profiling and development

Set `WOW_MIRROR_DEBUG=1` in the Stream Deck process environment before starting Stream Deck to log one line per 30 seconds with frame size, capture wait, processing time, encoded cells, active actions, and RSS memory. Compare Stream Deck's plugin process CPU and memory in Task Manager while WoW is idle and active. At the default interval, count changed image updates and check that only one capture session exists for all mapped keys. These timings include waiting for a frame and therefore are not pure GPU capture cost. No CPU or game FPS target has been measured here.

The TypeScript is formatted with Prettier (`npm run format`). `npm run lint` runs the strict TypeScript check. Tests cover row-column placement, bounds, dropdown options, settings normalization, shortcut parsing, crop comparison, and BGRA color conversion.

`npm audit --omit=dev` currently reports a high-severity memory-exhaustion advisory in `zod`, pulled in by the official SDK's `@elgato/utils`. The SDK requires Zod 3, and npm's suggested downgrade would remove the current SDK APIs used here. This plugin does not expose an HTTP endpoint; review SDK updates before distributing broadly.

## Windows 11 hardware smoke test

0. Open Notepad. Select it from **Target Window**, or enter `notepad.exe` manually, save the shared grid, and map one cell within its client area. Confirm the key shows Notepad content. This checks arbitrary-window selection before testing WoW.
1. Install/link the plugin, connect the original 15-key Deck, and add two buttons mapped to `2-3`, each with a different shortcut. Confirm their images match.
2. Configure the shared origin, size, and gaps once. Move the origin; confirm both buttons update after the next refresh. Change a visible spell icon or cooldown and check the next image.
3. Shrink the grid below row 2 or column 3. Confirm the dropdown marks `2-3` invalid and the button shows **Invalid cell**. Restore it.
4. With WoW foreground, press and hold a mapped key and check the configured binding in game. Release it and confirm no stuck key. Repeat with another application foreground; confirm it receives no shortcut.
5. Minimize/close and reopen WoW; confirm fallback and reconnect. Move WoW to a monitor at 125% scaling and verify the crop stays aligned. Recheck after a resize.
6. Add buttons across two Stream Decks if available; confirm one shared grid and independent settings. Check diagnostic output, CPU, memory, and image update frequency.

## Native and SDK notes

The current [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/guides/keys/) provides action lifecycle events and image data URLs; [global settings](https://docs.elgato.com/streamdeck/sdk/guides/settings/) synchronize the shared grid. The [manifest](https://docs.elgato.com/streamdeck/sdk/references/manifest/) requests SDK v3, Stream Deck 7.1+, and Node 24. The [CLI](https://docs.elgato.com/streamdeck/cli/intro/) builds and validates the plugin. Physical key coordinates exist in the protocol, but are intentionally not used as game-cell assignments.

[`@screen-capture/node` 1.1.0](https://github.com/tux-tn/node-screen-capture) uses Windows Graphics Capture, exposes window discovery and one async window session, requires Windows 10 1903+ and Node 20.17+/24-compatible N-API, and is MIT licensed. [`koffi` 3.3.4](https://koffi.dev/) is an MIT-licensed N-API 8 FFI package used only for `SendInput` and client-area Win32 calls. [`sharp` 0.35.5](https://sharp.pixelplumbing.com/) handles PNG resizing. The build copies their Windows x64 native binaries and runtime dependencies. They loaded under a local Windows Node 24.22.1 process; this does **not** establish successful capture or WoW input on a real desktop. The Stream Deck 7.6 documentation lists its Node 24 runtime as 24.22.1, but a hardware test remains necessary.
