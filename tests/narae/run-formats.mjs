import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? path.join(repo, "../narae-analysis/runtime-fixtures"));
const at = (name) => path.join(out, name);
const platform = process.platform === "win32" ? "win32-x64" : `${process.platform}-${process.arch}`;
const ffmpeg = process.env.NARAE_TEST_FFMPEG ?? path.join(repo, "bin", platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = process.env.NARAE_TEST_FFPROBE ?? path.join(repo, "bin", platform, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const runCli = (args, name) => {
  const result = spawnSync(process.execPath, [path.join(repo, "cli/narae.mjs"), ...args, "--result", at(`${name}.result.json`)], {
    cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 240000,
    env: { ...process.env, NARAE_CONFIG_HOME: at("private-cli-config"), NARAE_KEEP_RUNS: "1" },
  });
  fs.writeFileSync(at(`${name}.cli.log`), (result.stdout ?? "") + "\n" + (result.stderr ?? ""));
  assert.equal(result.status, 0, `${name}: ${result.error?.message ?? result.stderr}`);
  const report = JSON.parse(fs.readFileSync(at(`${name}.result.json`), "utf8"));
  assert.equal(report.ok, true, `${name}: ${report.error}`);
  return report;
};
const prepare = at("formats-prep.job.json");
fs.writeFileSync(prepare, JSON.stringify({ version: 1, timeoutMs: 120000, project: at("visual.nmm"), configure: { durationMs: 1000 }, saveProject: at("formats.nmm"), overwrite: true }, null, 2));
runCli(["run", prepare], "formats-prep");
const summaries = [];
for (const [extension, codec] of [["mov", "prores"], ["webm", "vp9"], ["gif", "gif"]]) {
  const output = at(`format.${extension}`);
  const report = runCli(["render", at("formats.nmm"), output, "--overwrite"], `format-${extension}`);
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8", windowsHide: true }));
  const video = probe.streams.find((s) => s.codec_type === "video");
  assert.ok(video, `${extension}: video stream`);
  assert.equal(video.codec_name, codec, `${extension}: container's normalized codec`);
  assert.equal(video.width, 320);
  assert.equal(video.height, 180);
  assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.2, `${extension}: duration ${probe.format.duration}`);
  execFileSync(ffmpeg, ["-v", "error", "-i", output, "-f", "null", "-"], { windowsHide: true });
  let rms;
  if (extension !== "gif") {
    assert.ok(probe.streams.some((s) => s.codec_type === "audio"), `${extension}: audio stream`);
    const samples = execFileSync(ffmpeg, ["-v", "error", "-i", output, "-vn", "-f", "f32le", "-ac", "1", "-ar", "8000", "pipe:1"], { windowsHide: true });
    let energy = 0;
    for (let offset = 0; offset + 4 <= samples.length; offset += 4) energy += samples.readFloatLE(offset) ** 2;
    rms = Math.sqrt(energy / (samples.length / 4));
    assert.ok(rms > 0.001, `${extension}: audible source survives, RMS ${rms}`);
  }
  const summary = { extension, codec, bytes: fs.statSync(output).size, duration: Number(probe.format.duration), rms, engine: report.engine, decoded: true };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
fs.writeFileSync(at("format-summary.json"), JSON.stringify({ ok: true, generatedAt: new Date().toISOString(), formats: summaries }, null, 2) + "\n");
