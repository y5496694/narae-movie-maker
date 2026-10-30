import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? path.join(repo, "../narae-analysis/runtime-fixtures"));
const names = process.argv.slice(3);
if (names.length === 0) names.push("inventory", "visual", "editing", "graphics", "parity", "reopen");
const at = (name) => path.join(out, name);
const platform = process.platform === "win32" ? "win32-x64" : `${process.platform}-${process.arch}`;
const ffprobe = process.env.NARAE_TEST_FFPROBE ?? path.join(repo, "bin", platform, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const ffmpeg = process.env.NARAE_TEST_FFMPEG ?? path.join(repo, "bin", platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const read = (name) => JSON.parse(fs.readFileSync(at(name), "utf8").replace(/^\uFEFF/, ""));
const summaries = [];

for (const name of names) {
  const job = read(`${name}.job.json`);
  const result = read(`${name}.result.json`);
  assert.equal(result.ok, true, `${name}: ${result.error ?? "job failed"}`);
  assert.equal(result.engine?.headless, true, `${name}: result must identify a headless engine`);
  assert.equal(result.steps.length, job.steps.length, `${name}: every requested step must run`);
  for (let i = 0; i < job.steps.length; i++) {
    const actual = result.steps[i];
    const expected = job.steps[i];
    assert.equal(actual.id, expected.id, `${name}: step order`);
    assert.equal(actual.tool, expected.tool, `${name}: tool dispatch`);
    assert.notEqual(actual.result?.ok, false, `${name}/${actual.id}: ${actual.result?.reason}`);
    const skipped = actual.result?.skipped;
    assert.equal(Array.isArray(skipped) ? skipped.length : typeof skipped === "number" ? skipped : 0, 0, `${name}/${actual.id}: no silently missing media`);
  }
  const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.result]));
  const overview = byId.overview ?? result.project;
  assert.equal(overview.resolution.width, 320, `${name}: project width`);
  assert.equal(overview.resolution.height, 180, `${name}: project height`);
  assert.equal(overview.fps, 30, `${name}: project fps`);
  if (name === "visual") {
    assert.equal(overview.clipCount, 9, "visual: media, transition, shape, text, image and effect persist");
    assert.equal(overview.clipsByType.video, 2);
    assert.equal(overview.clipsByType.text, 3);
    assert.equal(overview.clipsByType.effect, 1);
    assert.equal(overview.clipsByType.transition, 1);
  }
  if (name === "editing") {
    assert.equal(byId.splitList.total, 3, "split must produce three video clips");
    assert.equal(byId.mergedList.total, 1, "merge must restore one continuous video clip");
    assert.equal(result.project.clipsByType.video, 1);
    assert.equal(result.project.clipsByType.audio, 2, "detached audio and independent audio survive");
  }
  if (name === "graphics") {
    assert.equal(byId.contactSheet.warning, undefined, "HTML contact sheet must paint every requested graphic");
    assert.equal(result.project.clipsByType.graphic, 2, "HTML title and GLSL background survive");
  }
  if (name === "reopen") {
    const original = read("visual.result.json").project;
    assert.equal(overview.clipCount, original.clipCount, "reopen preserves all clips");
    assert.deepEqual(overview.clipsByType, original.clipsByType, "reopen preserves clip types");
    assert.deepEqual(overview.resolution, original.resolution, "reopen preserves project frame");
  }
  if (job.saveProject) assert.ok(fs.statSync(job.saveProject).size > 0, `${name}: nonempty saved project`);
  if (job.export) {
    const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", job.export.path], { encoding: "utf8", windowsHide: true }));
    const video = probe.streams.find((s) => s.codec_type === "video");
    assert.ok(video, `${name}: exported video stream exists`);
    assert.equal(video.width, 320, `${name}: exported width`);
    assert.equal(video.height, 180, `${name}: exported height`);
    assert.ok(Math.abs(Number(probe.format.duration) - job.configure.durationMs / 1000) < 0.15, `${name}: exported duration`);
    assert.ok(fs.statSync(job.export.path).size > 1000, `${name}: nontrivial video file`);
    execFileSync(ffmpeg, ["-v", "error", "-i", job.export.path, "-f", "null", "-"], { windowsHide: true });
    if (name === "visual") {
      assert.ok(probe.streams.some((s) => s.codec_type === "audio"), "visual: audible media exports an audio stream");
      const samples = execFileSync(ffmpeg, ["-v", "error", "-i", job.export.path, "-vn", "-f", "f32le", "-ac", "1", "-ar", "8000", "pipe:1"], { windowsHide: true });
      let energy = 0;
      for (let offset = 0; offset + 4 <= samples.length; offset += 4) energy += samples.readFloatLE(offset) ** 2;
      const rms = Math.sqrt(energy / (samples.length / 4));
      assert.ok(rms > 0.001, `visual: source tone must remain audible, measured RMS ${rms}`);
    }
  }
  if (name === "parity") {
    assert.equal(byId.reverse.generated, 1, "one reverse file was fully generated");
    assert.equal(byId.reverse.failed.length, 0, "reverse has no hidden partial failure");
    assert.match(fs.readFileSync(at("roundtrip.srt"), "utf8"), /만승초등학교/);
    assert.ok(fs.statSync(at("audit.cttpl")).size > 0, "portable template archive exists");
    assert.equal(byId.detail.slots.length, 2, "export and install retain media and text slots");
    assert.equal(byId.filledDetail.fills[byId.markText.slots[0].slotId].text, "만승초등학교");
    assert.equal(byId.compositions.compositions.length, 1, "expansion creates an editable composition");
    assert.equal(byId.proxies.failed.length, 0, "proxy generation reports no failed source");
    assert.equal(byId.proxies.made.length, 1, "forced generation makes a real proxy");
    assert.ok(fs.statSync(byId.proxies.made[0].proxy).size > 0, "generated proxy exists");
    assert.equal(byId.proxyStatus.mode, "prefer");
  }
  summaries.push({ name, steps: result.steps.length, clipCount: result.project?.clipCount, exported: Boolean(job.export) });
}
console.log(JSON.stringify({ ok: true, scenarios: summaries }, null, 2));
