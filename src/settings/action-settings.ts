export interface ActionSettings {
    [key: string]: string | boolean;
    position: string;
    shortcut: string;
}
export const DEFAULT_ACTION: ActionSettings = {
    position: "",
    shortcut: ""
};
export function normalizeAction(value: unknown): ActionSettings {
    const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
        position: typeof v.position === "string" ? v.position : "",
        shortcut: typeof v.shortcut === "string" ? v.shortcut.slice(0, 64) : ""
    };
}
