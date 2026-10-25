import type { GridSettings } from "../settings/global-grid-settings.js";

export function selectWindow<
  T extends { title: string; processName: string; handle?: number },
>(
  windows: T[],
  grid: Pick<GridSettings, "windowProcess" | "windowTitle"> &
    Partial<Pick<GridSettings, "windowHandle">>,
): T | null {
  if (!grid.windowProcess && !grid.windowTitle) return null;
  const executable = grid.windowProcess.toLowerCase();
  const title = grid.windowTitle.toLowerCase();
  const candidates = windows.filter(
    (w) => !executable || w.processName.toLowerCase() === executable,
  );
  return (
    candidates.find(
      (w) => (grid.windowHandle ?? 0) > 0 && w.handle === grid.windowHandle,
    ) ??
    candidates.find((w) => title && w.title.toLowerCase() === title) ??
    candidates.find((w) => title && w.title.toLowerCase().includes(title)) ??
    (executable ? candidates[0] : null) ??
    null
  );
}
