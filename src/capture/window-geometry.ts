import type { ClientRect } from "./image-processor.js";

export type ScreenRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export function mapClientToFrame(
    clientOrigin: { x: number; y: number },
    clientSize: { width: number; height: number },
    frameSize: { width: number; height: number },
    windowBounds: ScreenRect,
    visibleBounds?: ScreenRect
): ClientRect | null {
    if (clientSize.width <= 0 || clientSize.height <= 0 || frameSize.width <= 0 || frameSize.height <= 0) {
        return null;
    }

    const bounds = [visibleBounds, windowBounds].filter(
        (rect): rect is ScreenRect => !!rect && rect.right > rect.left && rect.bottom > rect.top
    );
    if (!bounds.length) {
        return null;
    }
    bounds.sort((a, b) => {
        const error = (rect: ScreenRect) =>
            Math.abs(rect.right - rect.left - frameSize.width) + Math.abs(rect.bottom - rect.top - frameSize.height);
        return error(a) - error(b);
    });
    const anchor = bounds[0];
    const client = {
        x: clientOrigin.x - anchor.left,
        y: clientOrigin.y - anchor.top,
        width: clientSize.width,
        height: clientSize.height
    };
    // A capture may omit a narrow strip of the client area, especially around
    // custom or maximized window borders. Individual cells check their own bounds.
    return client.x < frameSize.width
        && client.y < frameSize.height
        && client.x + client.width > 0
        && client.y + client.height > 0
        ? client
        : null;
}
