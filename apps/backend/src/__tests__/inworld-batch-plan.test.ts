import { describe, it, expect } from "vitest";
import { parseSilences, planCuts } from "../stt/providers/inworld-batch-plan.js";

const OPTIONS = { targetSec: 600, windowSec: 60, minTailSec: 30 };
const silence = (middle: number, length: number) => ({ start: middle - length / 2, end: middle + length / 2 });

describe("parseSilences", () => {
  it("pairs silence_start and silence_end lines, ignoring progress noise and clamping a negative start", () => {
    const stderr = [
      "size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x    [silencedetect @ 0x1] silence_start: -0.0023",
      "[silencedetect @ 0x1] silence_end: 1.3284 | silence_duration: 1.3307",
      "frame=  1 fps=0.0 q=-0.0 size=N/A time=00:00:11.00 bitrate=N/A",
      "[silencedetect @ 0x1] silence_start: 10.8467",
      "[silencedetect @ 0x1] silence_end: 11.3835 | silence_duration: 0.536854",
    ].join("\r\n");

    expect(parseSilences(stderr)).toEqual([
      { start: 0, end: 1.3284 },
      { start: 10.8467, end: 11.3835 },
    ]);
  });

  it("ignores a final silence that never ends (audio ending in silence)", () => {
    const stderr =
      "[silencedetect @ 0x1] silence_start: 5\n[silencedetect @ 0x1] silence_end: 6 | silence_duration: 1\n[silencedetect @ 0x1] silence_start: 90";

    expect(parseSilences(stderr)).toEqual([{ start: 5, end: 6 }]);
  });
});

describe("planCuts", () => {
  it("does not cut audio that fits in one segment", () => {
    expect(planCuts(500, [silence(300, 2)], OPTIONS)).toEqual([]);
    expect(planCuts(629, [], OPTIONS)).toEqual([]);
  });

  it("cuts in the middle of the silence closest to each multiple of the target", () => {
    const cuts = planCuts(1815, [silence(595, 3), silence(1215, 3)], OPTIONS);

    expect(cuts).toEqual([595, 1215]);
  });

  it("prefers the longest silence in the window, then the closest to the target", () => {
    expect(planCuts(1000, [silence(560, 1), silence(650, 4)], OPTIONS)).toEqual([650]);
    expect(planCuts(1000, [silence(630, 2), silence(590, 2)], OPTIONS)).toEqual([590]);
  });

  it("cuts exactly at the target when no silence is close enough", () => {
    expect(planCuts(1000, [silence(500, 5), silence(700, 5)], OPTIONS)).toEqual([600]);
  });

  it("keeps every segment within target + 2×window and never leaves a tiny tail", () => {
    const total = 7385;
    const silences = Array.from({ length: 12 }, (_, i) => silence(i * 600 + 45 + (i % 2) * 20, 1.5));

    const cuts = planCuts(total, silences, OPTIONS);

    const bounds = [0, ...cuts, total];
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i] - bounds[i - 1]).toBeGreaterThan(0);
      expect(bounds[i] - bounds[i - 1]).toBeLessThanOrEqual(OPTIONS.targetSec + 2 * OPTIONS.windowSec);
    }
    expect(total - cuts[cuts.length - 1]).toBeGreaterThanOrEqual(OPTIONS.minTailSec);
  });
});
