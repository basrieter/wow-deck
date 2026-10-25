export interface ActionSettings {
  [key: string]: string | boolean;
  position: string;
  shortcut: string;
  mirror: boolean;
}
export const DEFAULT_ACTION: ActionSettings = {
  position: "",
  shortcut: "",
  mirror: true,
};
export function normalizeAction(value: unknown): ActionSettings {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    position: typeof v.position === "string" ? v.position : "",
    shortcut: typeof v.shortcut === "string" ? v.shortcut.slice(0, 64) : "",
    mirror: v.mirror !== false,
  };
}
