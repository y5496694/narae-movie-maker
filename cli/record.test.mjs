import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRecordingInvocation, runRecordingCommand } from "./record.mjs";

const WINDOWS = { ffmpegPath: "missing-test-ffmpeg.exe", platform: "win32", cwd: process.cwd() };
const output = ["--output", "test capture.mp4", "--seconds", "2"];

test("Windows screen capture has explicit duration, no implicit microphone and no overwrite", () => {
  const invocation = buildRecordingInvocation("record-screen", output, WINDOWS);
  assert.deepEqual(invocation.command, [
    WINDOWS.ffmpegPath, "-hide_banner", "-nostats", "-n", "-thread_queue_size", "512",
    "-f", "gdigrab", "-framerate", "30", "-i", "desktop", "-t", "2", "-map", "0:v:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-an", "-movflags", "+faststart", path.resolve("test capture.mp4"),
  ]);
});

test("Windows camera and microphone names remain single literal argv entries", () => {
  const camera = 'Camera $(ignored) & "name"';
  const microphone = "마이크 (USB Audio)";
  const invocation = buildRecordingInvocation("record-camera", [
    ...output, "--video-device", camera, "--audio-device", microphone, "--fps", "30000/1001", "--overwrite",
  ], WINDOWS);
  assert(invocation.command.includes(`video=${camera}`));
  assert(invocation.command.includes(`audio=${microphone}`));
  assert(invocation.command.includes("30000/1001"));
  assert(invocation.command.includes("1:a:0"));
  assert(invocation.command.includes("-y"));
  assert(!invocation.command.includes("-n"));
});

test("Windows region accepts negative monitor offsets and odd dimensions", () => {
  const invocation = buildRecordingInvocation("record-screen", [...output, "--region=-1920,0,801,601"], WINDOWS);
  assert.equal(invocation.command[invocation.command.indexOf("-offset_x") + 1], "-1920");
  assert.equal(invocation.command[invocation.command.indexOf("-video_size") + 1], "801x601");
  assert(invocation.command.includes("pad=ceil(iw/2)*2:ceil(ih/2)*2"));
});

test("finite duration and explicit device/output are mandatory", () => {
  for (const seconds of ["0", "-1", "Infinity", "NaN", "1e309"]) {
    assert.throws(() => buildRecordingInvocation("record-screen", ["--output", "a.mp4", "--seconds", seconds], WINDOWS));
  }
  assert.throws(() => buildRecordingInvocation("record-screen", ["--seconds", "2"], WINDOWS), /--output/u);
  assert.throws(() => buildRecordingInvocation("record-camera", output, WINDOWS), /--video-device/u);
  assert.throws(() => buildRecordingInvocation("record-audio", ["--output", "a.wav", "--seconds", "2"], WINDOWS), /--audio-device/u);
});

test("unknown, duplicate and incompatible options fail before any capture", () => {
  for (const extras of [["--fps", "0"], ["--fps", "500"], ["--fps", "30/0"], ["--region", "1,2,0,4"], ["--mystery"], ["--seconds", "3"]]) {
    assert.throws(() => buildRecordingInvocation("record-screen", [...output, ...extras], WINDOWS));
  }
  assert.throws(() => buildRecordingInvocation("record-camera", [...output, "--video-device", "camera:audio=unexpected"], WINDOWS), /구분자/u);
  assert.throws(() => buildRecordingInvocation("record-audio", ["--output", "a.wav", "--seconds", "2", "--audio-device", "Mic", "--fps", "30"], WINDOWS));
  assert.throws(() => buildRecordingInvocation("record-screen", ["--output", "a.mp3", "--seconds", "2"], WINDOWS), /확장자/u);
  assert.throws(() => buildRecordingInvocation("devices", ["--seconds", "2"], WINDOWS));
});

test("audio recording uses the selected format and explicit microphone", () => {
  const invocation = buildRecordingInvocation("record-audio", ["--output", "voice.wav", "--seconds", "0.5", "--audio-device", "Mic"], WINDOWS);
  assert(invocation.command.includes("audio=Mic"));
  assert(invocation.command.includes("pcm_s16le"));
  assert(invocation.command.includes("0:a:0"));
  assert(!invocation.command.includes("-c:v"));
});

test("Linux command construction supports X11, V4L2 and explicit Pulse source", () => {
  const linux = { ...WINDOWS, platform: "linux", env: { DISPLAY: ":0.0" } };
  const screen = buildRecordingInvocation("record-screen", [...output, "--region", "10,20,800,600", "--audio-device", "default"], linux);
  assert(screen.command.includes(":0.0+10,20"));
  assert(screen.command.includes("pulse"));
  const camera = buildRecordingInvocation("record-camera", [...output, "--video-device", "/dev/video2"], linux);
  assert(camera.command.includes("v4l2"));
  assert(camera.command.includes("/dev/video2"));
  assert.throws(() => buildRecordingInvocation("record-screen", output, { ...linux, env: {} }), /DISPLAY/u);
});

test("macOS requires an explicit screen device, combines AVFoundation streams and crops", () => {
  const mac = { ...WINDOWS, platform: "darwin" };
  assert.throws(() => buildRecordingInvocation("record-screen", output, mac), /--video-device/u);
  const invocation = buildRecordingInvocation("record-screen", [...output, "--video-device", "Capture screen 0", "--audio-device", "0", "--region", "10,20,800,600"], mac);
  assert(invocation.command.includes("Capture screen 0:0"));
  assert(invocation.command.includes("0:a:0"));
  assert(invocation.command.includes("crop=800:600:10:20,pad=ceil(iw/2)*2:ceil(ih/2)*2"));
});

test("device listing dry runs never invoke FFmpeg or capture a device", async () => {
  const windows = await runRecordingCommand("devices", ["--dry-run"], WINDOWS);
  assert.deepEqual(windows.command.slice(-6), ["-list_devices", "true", "-f", "dshow", "-i", "dummy"]);
  const mac = await runRecordingCommand("devices", ["--dry-run"], { ...WINDOWS, platform: "darwin" });
  assert.deepEqual(mac.command.slice(-6), ["-f", "avfoundation", "-list_devices", "true", "-i", ""]);
  assert.match((await runRecordingCommand("record-screen", ["--help"], {})).help, /--seconds/u);
});

test("dry run is read-only, and an existing output is rejected before process launch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "narae-record-"));
  try {
    const target = path.join(directory, "nested", "record.mp4");
    const invocation = await runRecordingCommand("record-screen", ["--output", target, "--seconds", "2", "--dry-run"], WINDOWS);
    assert.equal(invocation.dryRun, true);
    await assert.rejects(stat(path.dirname(target)), { code: "ENOENT" });
    const existing = path.join(directory, "keep.mp4");
    await writeFile(existing, "existing-data");
    await assert.rejects(runRecordingCommand("record-screen", ["--output", existing, "--seconds", "2"], WINDOWS), /--overwrite/u);
    assert.equal(await readFile(existing, "utf8"), "existing-data");
    await assert.rejects(runRecordingCommand("record-screen", ["--output", target, "--seconds", "2"], { ...WINDOWS, signal: AbortSignal.abort() }), { code: "ABORT_ERR" });
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith("narae-record-"));
    await rm(directory, { recursive: true, force: true });
  }
});
