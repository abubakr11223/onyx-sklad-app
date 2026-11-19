import { describe, expect, it } from "vitest";
import { videoGuideHref } from "@/lib/video-guide";

describe("videoGuideHref", () => {
  it("каждая роль получает своё видео", () => {
    expect(videoGuideHref("OWNER")).toBe("/video/onyx-vladelets.mp4");
    expect(videoGuideHref("MANAGER")).toBe("/video/onyx-menedzher.mp4");
    expect(videoGuideHref("WAREHOUSE_LEAD")).toBe("/video/onyx-zavsklad.mp4");
  });
  it("складчику — видео зав. складом, партнёру — ничего", () => {
    expect(videoGuideHref("WAREHOUSE")).toBe("/video/onyx-zavsklad.mp4");
    expect(videoGuideHref("PARTNER")).toBeNull();
  });
});
