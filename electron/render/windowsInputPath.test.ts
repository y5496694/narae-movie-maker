import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";
import { buildFFmpegArgs } from "./ffmpegArgs";

describe("export audio source paths", () => {
  it("passes a filesystem path to FFmpeg for a file URL containing spaces and Korean", () => {
    const input = path.join(os.tmpdir(), "school video", "한국어 음성.wav");
    const url = pathToFileURL(input).href;
    const args = buildFFmpegArgs({ videoDuration: 1, videoBitrate: 5000, videoDestination: path.join(os.tmpdir(), "test.mp4") }, {
      voice: { filetype: "audio", localpath: url, startTime: 0, duration: 1000, trim: { startTime: 0, endTime: 1000 }, speed: 1 },
    });
    expect(args).toContain(input);
    expect(args).not.toContain(url);
  });
});
