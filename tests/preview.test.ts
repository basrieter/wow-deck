import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderPreview } from "../src/capture/image-processor.js";

describe("window preview", () => {
  it("keeps BGRA colors correct in the resized preview", async () => {
    const buffer = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 0;
      buffer[i + 1] = 0;
      buffer[i + 2] = 255;
      buffer[i + 3] = 255;
    }
    const url = await renderPreview({
      buffer,
      width: 4,
      height: 4,
      colorFormat: "bgra8",
    });
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const rgb = await sharp(Buffer.from(url.split(",")[1], "base64"))
      .raw()
      .toBuffer();
    expect(rgb[0]).toBeGreaterThan(200);
    expect(rgb[2]).toBeLessThan(50);
  });
});
