import { enumerateWindows, type WindowInfo } from "@screen-capture/node";
import koffi from "koffi";
import path from "node:path";
import type { GridSettings } from "../settings/global-grid-settings.js";
import type { ClientRect } from "./image-processor.js";
import { selectWindow } from "./window-selection.js";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const RECT = koffi.struct("WOW_RECT", {
  left: "long",
  top: "long",
  right: "long",
  bottom: "long",
});
const POINT = koffi.struct("WOW_POINT", { x: "long", y: "long" });
const getClientRect = user32.func(
  "int GetClientRect(intptr_t hwnd, _Out_ WOW_RECT *rect)",
);
const clientToScreen = user32.func(
  "int ClientToScreen(intptr_t hwnd, _Inout_ WOW_POINT *point)",
);
const isIconic = user32.func("int IsIconic(intptr_t hwnd)");
const isWindow = user32.func("int IsWindow(intptr_t hwnd)");
const isWindowVisible = user32.func("int IsWindowVisible(intptr_t hwnd)");
const getForegroundWindow = user32.func("intptr_t GetForegroundWindow(void)");
const getTopWindow = user32.func("intptr_t GetTopWindow(intptr_t hwnd)");
const getWindow = user32.func(
  "intptr_t GetWindow(intptr_t hwnd, uint command)",
);
const getWindowRect = user32.func(
  "int GetWindowRect(intptr_t hwnd, _Out_ WOW_RECT *rect)",
);
const getWindowText = user32.func(
  "int GetWindowTextW(intptr_t hwnd, void *buffer, int maxCount)",
);
const getWindowThreadProcessId = user32.func(
  "uint GetWindowThreadProcessId(intptr_t hwnd, void *pid)",
);
const enumProc = koffi.proto(
  "int __stdcall WOW_EnumWindowsProc(intptr_t hwnd, intptr_t param)",
);
const enumWindows = user32.func("EnumWindows", "int", [
  koffi.pointer(enumProc),
  "intptr_t",
]);
const openProcess = kernel32.func(
  "intptr_t OpenProcess(uint access, int inherit, uint pid)",
);
const queryImageName = kernel32.func(
  "int QueryFullProcessImageNameW(intptr_t proc, uint flags, void *buffer, void *size)",
);
const closeHandle = kernel32.func("int CloseHandle(intptr_t handle)");
const setDpiContext = user32.func(
  "int SetProcessDpiAwarenessContext(intptr_t value)",
);

export function enablePhysicalPixels() {
  // PER_MONITOR_AWARE_V2. A previous host choice can make this fail harmlessly.
  try {
    setDpiContext(-4);
  } catch {
    /* older Windows */
  }
}

let windowCache: WindowInfo[] = [];
let windowCacheAt = 0;
let discoveryStatus = "Window discovery has not run";
export function windowDiscoveryStatus() {
  return discoveryStatus;
}
function processName(pid: number): string {
  const handle = openProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (!handle) return `pid-${pid}`;
  try {
    const buffer = Buffer.alloc(2048);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(1024);
    if (!queryImageName(handle, 0, buffer, size)) return `pid-${pid}`;
    return path.win32.basename(
      buffer.toString("utf16le", 0, size.readUInt32LE(0) * 2),
    );
  } finally {
    closeHandle(handle);
  }
}

function readWindow(handle: number): WindowInfo | null {
  if (!handle || !isWindow(handle) || !isWindowVisible(handle)) return null;
  const titleBuffer = Buffer.alloc(1024);
  const length = getWindowText(handle, titleBuffer, 512);
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!getWindowRect(handle, rect)) return null;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return null;
  const pidBuffer = Buffer.alloc(4);
  if (!getWindowThreadProcessId(handle, pidBuffer)) return null;
  const pid = pidBuffer.readUInt32LE(0);
  return {
    title: titleBuffer.toString("utf16le", 0, length * 2),
    processId: pid,
    processName: processName(pid),
    rect,
    titleBarHeight: 0,
    width,
    height,
    isValid: true,
    handle,
  };
}

export function foregroundWindowInfo(): WindowInfo | null {
  try {
    return readWindow(getForegroundWindow());
  } catch {
    return null;
  }
}

export function listWindows(force = false): WindowInfo[] {
  if (!force && Date.now() - windowCacheAt < 1000) return windowCache;
  const results: WindowInfo[] = [];
  let visitedCount = 0;
  let visibleCount = 0;
  let firstError = "";
  const inspect = (handle: number) => {
    visitedCount++;
    try {
      if (!isWindowVisible(handle)) return;
      visibleCount++;
      const window = readWindow(handle);
      if (window) results.push(window);
    } catch (error) {
      if (!firstError) firstError = String(error);
    }
  };
  try {
    enumWindows((handle: number) => {
      inspect(handle);
      return 1;
    }, 0);
  } catch (error) {
    if (!firstError) firstError = String(error);
  }
  if (!results.length) {
    // Fallback when a host cannot invoke callbacks through EnumWindows.
    try {
      const visited = new Set<number>();
      let handle = getTopWindow(0);
      while (handle && !visited.has(handle) && visited.size < 4096) {
        visited.add(handle);
        inspect(handle);
        handle = getWindow(handle, 2); // GW_HWNDNEXT
      }
    } catch (error) {
      if (!firstError) firstError = String(error);
    }
  }
  if (!results.length) {
    try {
      const foreground = getForegroundWindow();
      if (foreground) inspect(foreground);
    } catch (error) {
      if (!firstError) firstError = String(error);
    }
  }
  if (!results.length) {
    try {
      results.push(...enumerateWindows().filter((w) => w.isValid));
    } catch (error) {
      if (!firstError) firstError = String(error);
    }
  }
  discoveryStatus = results.length
    ? `${results.length} selectable windows found`
    : `No windows discovered (visited ${visitedCount} handles, ${visibleCount} visible${firstError ? `; ${firstError.slice(0, 120)}` : ""})`;
  windowCache = results;
  windowCacheAt = Date.now();
  return results;
}

export function resolveWindow(grid: GridSettings): WindowInfo | null {
  if (grid.windowHandle > 0) {
    try {
      const direct = readWindow(grid.windowHandle);
      if (
        direct &&
        (!grid.windowProcess ||
          direct.processName.toLowerCase() === grid.windowProcess.toLowerCase())
      )
        return direct;
    } catch {
      /* stale handle */
    }
  }
  return selectWindow(listWindows(), grid);
}

export function isForeground(window: WindowInfo): boolean {
  try {
    return !!isWindow(window.handle) && getForegroundWindow() === window.handle;
  } catch {
    return false;
  }
}
export function isMinimized(window: WindowInfo): boolean {
  return !!isIconic(window.handle);
}

export function clientBounds(
  window: WindowInfo,
  frameWidth: number,
  frameHeight: number,
): ClientRect | null {
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const point = { x: 0, y: 0 };
  if (
    !getClientRect(window.handle, rect) ||
    !clientToScreen(window.handle, point)
  )
    return null;
  const width = rect.right - rect.left,
    height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return null;
  // WGC frame usually matches the window bounds. Frame-size delta is distributed
  // around the physical Win32 window rectangle (invisible resize borders).
  const windowWidth = window.rect.right - window.rect.left;
  const windowHeight = window.rect.bottom - window.rect.top;
  const x = Math.round(
    point.x - window.rect.left - Math.max(0, windowWidth - frameWidth) / 2,
  );
  const y = Math.round(
    point.y - window.rect.top - Math.max(0, windowHeight - frameHeight) / 2,
  );
  return x >= 0 &&
    y >= 0 &&
    x + width <= frameWidth &&
    y + height <= frameHeight
    ? { x, y, width, height }
    : null;
}
