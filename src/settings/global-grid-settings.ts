export interface GridSettings {
    windowProcess: string;
    windowTitle: string;
    windowHandle: number;
    originX: number;
    originY: number;
    cellWidth: number;
    cellHeight: number;
    rowCount: number;
    columnCount: number;
    horizontalGap: number;
    verticalGap: number;
    captureInterval: 250 | 500 | 1000 | 2000;
    hashChangeDetection: boolean;
    debugLogging: boolean;
}

export const DEFAULT_GRID: GridSettings = {
    windowProcess: "",
    windowTitle: "",
    windowHandle: 0,
    originX: 0,
    originY: 0,
    cellWidth: 48,
    cellHeight: 48,
    rowCount: 3,
    columnCount: 5,
    horizontalGap: 0,
    verticalGap: 0,
    captureInterval: 1000,
    hashChangeDetection: true,
    debugLogging: false
};

const bounded = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

export function normalizeGrid(value: unknown): GridSettings {
    const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const interval = [250, 500, 1000, 2000].includes(Number(v.captureInterval)) ? Number(v.captureInterval) : 1000;
    return {
        windowProcess: typeof v.windowProcess === "string" ? v.windowProcess.slice(0, 260) : "",
        windowTitle: typeof v.windowTitle === "string" ? v.windowTitle.slice(0, 260) : "",
        windowHandle: bounded(v.windowHandle, 0, Number.MAX_SAFE_INTEGER, 0),
        originX: bounded(v.originX, 0, 100000, 0),
        originY: bounded(v.originY, 0, 100000, 0),
        cellWidth: bounded(v.cellWidth, 1, 4096, 48),
        cellHeight: bounded(v.cellHeight, 1, 4096, 48),
        rowCount: bounded(v.rowCount, 1, 12, 3),
        columnCount: bounded(v.columnCount, 1, 12, 5),
        horizontalGap: bounded(v.horizontalGap, 0, 4096, 0),
        verticalGap: bounded(v.verticalGap, 0, 4096, 0),
        captureInterval: interval as GridSettings["captureInterval"],
        hashChangeDetection: typeof v.hashChangeDetection === "boolean" ? v.hashChangeDetection : true,
        debugLogging: typeof v.debugLogging === "boolean" ? v.debugLogging : false
    };
}

export function positions(grid: GridSettings): string[] {
    return Array.from(
        { length: grid.rowCount * grid.columnCount },
        (_, i) => `${Math.floor(i / grid.columnCount) + 1}-${(i % grid.columnCount) + 1}`
    );
}

export function cellRegion(grid: GridSettings, position: string, clientWidth: number, clientHeight: number) {
    const match = /^(\d+)-(\d+)$/.exec(position);
    if (!match) {
        return null;
    }
    const row = Number(match[1]),
        col = Number(match[2]);
    if (row < 1 || col < 1 || row > grid.rowCount || col > grid.columnCount) {
        return null;
    }
    const x = grid.originX + (col - 1) * (grid.cellWidth + grid.horizontalGap);
    const y = grid.originY + (row - 1) * (grid.cellHeight + grid.verticalGap);
    if (x + grid.cellWidth > clientWidth || y + grid.cellHeight > clientHeight) {
        return null;
    }
    return { x, y, width: grid.cellWidth, height: grid.cellHeight };
}
