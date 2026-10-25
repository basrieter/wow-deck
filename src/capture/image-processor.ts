import sharp from "sharp";
import { createHash } from "node:crypto";
import type { GridSettings } from "../settings/global-grid-settings.js";
import { cellRegion } from "../settings/global-grid-settings.js";

export type RawFrame = {
    buffer: Buffer;
    width: number;
    height: number;
    colorFormat: string;
};
export type ClientRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export function sourceRegion(grid: GridSettings, position: string, client: ClientRect, frame: RawFrame) {
    const cell = cellRegion(grid, position, client.width, client.height);
    if (!cell) {
        return null;
    }
    const rect = {
        left: client.x + cell.x,
        top: client.y + cell.y,
        width: cell.width,
        height: cell.height
    };
    return rect.left >= 0
        && rect.top >= 0
        && rect.left + rect.width <= frame.width
        && rect.top + rect.height <= frame.height
        ? rect
        : null;
}

export function regionHash(
    frame: RawFrame,
    rect: { left: number; top: number; width: number; height: number }
): string {
    const hash = createHash("sha1");
    hash.update(`${rect.width}:${rect.height}:${frame.colorFormat}`);
    for (let y = rect.top; y < rect.top + rect.height; y++) {
        const start = (y * frame.width + rect.left) * 4;
        hash.update(frame.buffer.subarray(start, start + rect.width * 4));
    }
    return hash.digest("hex");
}

export async function renderCrop(frame: RawFrame, rect: { left: number; top: number; width: number; height: number }) {
    const pixels = Buffer.allocUnsafe(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y++) {
        const source = ((rect.top + y) * frame.width + rect.left) * 4;
        frame.buffer.copy(pixels, y * rect.width * 4, source, source + rect.width * 4);
    }
    if (frame.colorFormat === "bgra8") {
        for (let i = 0; i < pixels.length; i += 4) {
            const blue = pixels[i];
            pixels[i] = pixels[i + 2];
            pixels[i + 2] = blue;
        }
    }
    const png = await sharp(pixels, {
        raw: { width: rect.width, height: rect.height, channels: 4 }
    })
        .removeAlpha()
        .resize(144, 144, {
            fit: "contain",
            background: "#171923",
            kernel: "lanczos3"
        })
        .png()
        .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
}

export async function renderPreview(frame: RawFrame): Promise<string> {
    const { data, info } = await sharp(frame.buffer, {
        raw: { width: frame.width, height: frame.height, channels: 4 }
    })
        .removeAlpha()
        .resize(640, 400, { fit: "inside", withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
    if (frame.colorFormat === "bgra8") {
        for (let i = 0; i < data.length; i += 3) {
            const blue = data[i];
            data[i] = data[i + 2];
            data[i + 2] = blue;
        }
    }
    const jpeg = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 3 }
    })
        .jpeg({ quality: 72 })
        .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export function fallbackSvg(message: string) {
    const safe = message.replace(/[<>&"']/g, "");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#171923"/><text x="72" y="69" fill="#f0b35d" font-family="Arial" font-size="16" text-anchor="middle">WoW</text><text x="72" y="93" fill="white" font-family="Arial" font-size="12" text-anchor="middle">${safe}</text></svg>`;
}
