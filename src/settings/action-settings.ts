export interface ActionSettings {
    [key: string]: string | boolean;
    position: string;
    shortcut: string;
    live: boolean;
}
export const DEFAULT_ACTION: ActionSettings = {
    position: "",
    shortcut: "",
    live: true
};
export function normalizeAction(value: unknown): ActionSettings {
    const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
        position: typeof v.position === "string" ? v.position : "",
        shortcut: typeof v.shortcut === "string" ? v.shortcut.slice(0, 64) : "",
        // Existing buttons predate this setting, so they remain live by default.
        live: typeof v.live === "boolean" ? v.live : true
    };
}
