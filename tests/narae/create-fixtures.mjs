import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const out = path.resolve(process.argv[2] ?? path.join(repo, "../narae-analysis/runtime-fixtures"));
const platform = process.platform === "win32" ? "win32-x64" : `${process.platform}-${process.arch}`;
const ffmpeg = process.env.NARAE_TEST_FFMPEG ?? path.join(repo, "bin", platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
fs.mkdirSync(out, { recursive: true });
const at = (name) => path.join(out, name);
const write = (name, value) => fs.writeFileSync(at(name), JSON.stringify(value.version === 1 ? { timeoutMs: 120000, ...value } : value, null, 2) + "\n");
const ref = (key) => ({ $ref: key });
const step = (id, tool, args = {}) => ({ id, tool, args });
const configure = { width: 320, height: 180, fps: 30, durationMs: 6000, backgroundColor: "#102438" };
const exportSettings = { container: "mp4", videoCodec: "libx264", preset: "ultrafast", crf: 24, audioCodec: "aac" };
const render = (name) => ({ path: at(name), overwrite: true, settings: exportSettings });
const runFfmpeg = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { stdio: "pipe", windowsHide: true });

for (const [name, image, frequency] of [
  ["video-a.mp4", "testsrc2=size=320x180:rate=30", 440],
  ["video-b.mp4", "color=c=0x246ca8:size=320x180:rate=30", 660],
]) {
  runFfmpeg(["-f", "lavfi", "-i", image, "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`, "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", at(name)]);
}
runFfmpeg(["-f", "lavfi", "-i", "color=c=0xf5b942:size=96x64", "-frames:v", "1", at("still.png")]);
runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000", "-t", "6", "-c:a", "pcm_s16le", at("tone.wav")]);
fs.writeFileSync(at("korean.srt"), "1\n00:00:00,000 --> 00:00:01,000\n만승초등학교\n\n2\n00:00:01,000 --> 00:00:02,000\n함께 배우고 자라는 우리\n", "utf8");

write("inventory.job.json", {
  version: 1, configure,
  steps: [
    step("capabilities", "narae_capabilities"),
    step("overview", "get_project_overview"),
    step("fonts", "list_fonts", { groupBy: "family", query: "Noto", limit: 20 }),
    step("transitions", "list_transition_presets"),
    step("effects", "list_effect_presets"),
    step("graphics", "list_graphic_presets"),
    step("luts", "list_luts"),
    step("templates", "list_templates"),
    step("compositions", "list_compositions"),
  ],
});

write("visual.job.json", {
  version: 1, configure,
  steps: [
    step("media", "add_media", { items: [{ path: at("video-a.mp4"), startMs: 0 }, { path: at("video-b.mp4"), startMs: 3000 }] }),
    step("crop", "set_crop", { elementIds: [ref("media.created.0")], x: 0.05, y: 0.05, width: 0.9, height: 0.9 }),
    step("mirror", "set_mirror", { elementIds: [ref("media.created.1")], horizontal: true }),
    step("grade", "set_color_adjustments", { elementIds: [ref("media.created.0")], adjustments: { exposure: 8, saturation: 12, contrast: 6 } }),
    step("lut", "set_lut", { elementIds: [ref("media.created.1")], presetId: "com.cartcut.lut.print-2383", intensity: 25 }),
    step("transition", "add_transition", { fromId: ref("media.created.0"), toId: ref("media.created.1"), presetId: "com.cartcut.cross-dissolve", durationMs: 400 }),
    step("shape", "add_shape", { kind: "rectangle", startMs: 0, durationMs: 6000, x: 8, y: 127, width: 304, height: 45, fillColor: "#102438", fillOpacity: 80 }),
    step("title", "add_text", { text: "만승초등학교", startMs: 0, durationMs: 6000, style: { fontsize: 24, textcolor: "#ffffff", locationX: 8, locationY: 8, width: 304, height: 40, align: "center" } }),
    step("font", "set_text_font", { elementIds: [ref("title.created.0")], family: "NotoSansKR", weight: 700 }),
    step("wordStyle", "set_text_range_style", { elementId: ref("title.created.0"), ranges: [{ match: "만승" }], color: "#ffd873" }),
    step("titleReveal", "apply_typewriter", { elementIds: [ref("title.created.0")], unit: "character", durationMs: 700 }),
    step("captions", "add_subtitles", { items: [{ text: "함께 배우는 즐거움", startMs: 500, durationMs: 2300 }, { text: "꿈을 키우는 우리 학교", startMs: 3200, durationMs: 2300 }], style: { fontsize: 18, textcolor: "#ffffff", locationX: 12, locationY: 133, width: 296, height: 32, align: "center" } }),
    step("captionFont", "set_text_font", { elementIds: ref("captions.created"), family: "NotoSansKR", weight: 600 }),
    step("logo", "add_media", { items: [{ path: at("still.png"), startMs: 0, durationMs: 6000 }] }),
    step("logoBox", "update_clip", { elementId: ref("logo.created.0"), patch: { location: { x: 270, y: 52 }, width: 40, height: 30, opacity: 85 } }),
    step("mask", "set_mask", { elementIds: [ref("logo.created.0")], shape: "rectangle", roundness: 100, width: 95, height: 95, feather: 1 }),
    step("logoFade", "apply_animation_preset", { elementIds: [ref("logo.created.0")], preset: "fade_in", durationMs: 500 }),
    step("logoKeys", "add_keyframes", { elementId: ref("logo.created.0"), property: "rotation", keyframes: [{ atMs: 0, value: 0, easing: "linear" }, { atMs: 5900, value: 18 }] }),
    step("group", "group_clips", { elementIds: [ref("title.created.0"), ref("logo.created.0")], name: "학교 소개" }),
    step("ungroup", "ungroup", { groupIds: [ref("group.groupId")] }),
    step("effect", "add_effect", { presetId: "com.cartcut.vignette", startMs: 0, durationMs: 6000, intensity: 20, params: { amount: 0.2, radius: 0.9, tint: "#000000" } }),
    step("overview", "get_project_overview"),
    step("clips", "list_clips", { limit: 100 }),
    step("keys", "get_keyframes", { elementId: ref("logo.created.0"), property: "rotation" }),
    step("contactSheet", "get_contact_sheet", { atMs: [1000, 3000, 4500], columns: 3, tileWidth: 320 }),
  ],
  saveProject: at("visual.nmm"), overwrite: true, export: render("visual.mp4"),
});

write("editing.job.json", {
  version: 1, configure,
  steps: [
    step("media", "add_media", { items: [{ path: at("video-a.mp4"), startMs: 0 }] }),
    step("trim", "trim_clip", { elementId: ref("media.created.0"), startMs: 200, endMs: 2800 }),
    step("undoTrim", "undo"),
    step("split", "split_clip", { elementId: ref("media.created.0"), atMs: [1000, 2000] }),
    step("splitList", "list_clips", { filetype: "video", limit: 100 }),
    step("merge", "merge_clips", { elementIds: [ref("media.created.0"), ref("split.created.0"), ref("split.created.1")] }),
    step("mergedList", "list_clips", { filetype: "video", limit: 100 }),
    step("remove", "remove_ranges", { elementId: ref("media.created.0"), ranges: [{ startMs: 1000, endMs: 1500 }], ripple: true }),
    step("undoRemove", "undo"),
    step("speed", "set_clip_speed", { elementIds: [ref("media.created.0")], speed: 2, ripple: true }),
    step("spedClip", "get_clip", { elementId: ref("media.created.0") }),
    step("undoSpeed", "undo"),
    step("rotate", "rotate_clips", { elementIds: [ref("media.created.0")], degrees: 90 }),
    step("undoRotate", "undo"),
    step("filter", "set_video_filters", { elementIds: [ref("media.created.0")], filter: { name: "blur", strength: 0.15 } }),
    step("clearFilter", "set_video_filters", { elementIds: [ref("media.created.0")], filter: null }),
    step("detach", "detach_audio", { elementIds: [ref("media.created.0")] }),
    step("sound", "add_media", { items: [{ path: at("tone.wav"), startMs: 0 }] }),
    step("audioLevel", "update_clip", { elementId: ref("sound.created.0"), patch: { volumeDb: -18 } }),
    step("duplicate", "duplicate_clips", { elementIds: [ref("media.created.0")], toMs: 3000 }),
    step("deleteCopy", "delete_clips", { elementIds: ref("duplicate.created"), ripple: false }),
    step("redoDeleteUndo", "undo"),
    step("redoDelete", "redo"),
    step("clips", "list_clips", { limit: 100 }),
  ],
  saveProject: at("editing.nmm"), overwrite: true,
});

const shader = { kind: "graphic", name: "Audit gradient", render: { type: "shader", fragment: "vec4 graphic(vec2 uv) { return vec4(uv.x, uv.y, 0.35, 1.0); }" } };
write("graphics.job.json", {
  version: 1, configure: { ...configure, durationMs: 2000 },
  steps: [
    step("check", "check_program", { program: shader }),
    step("shader", "add_graphic", { program: shader, startMs: 0, durationMs: 2000 }),
    step("html", "add_graphic", { presetId: "com.cartcut.graphic.rise-in-out", params: { text: "NARAE", size: 160, color: "#ffffff" }, name: "HTML title", startMs: 0, durationMs: 2000, width: 280, height: 70, x: 20, y: 55 }),
    step("shaderRead", "get_program", { elementId: ref("shader.created.0") }),
    step("clips", "list_clips", { limit: 100 }),
    step("contactSheet", "get_contact_sheet", { atMs: [400, 1000, 1600], columns: 3, tileWidth: 320 }),
  ], saveProject: at("graphics.nmm"), overwrite: true, export: render("graphics.mp4"),
});

write("parity.job.json", {
  version: 1, configure,
  steps: [
    step("media", "add_media", { items: [{ path: at("video-a.mp4"), startMs: 0 }] }),
    step("reverse", "reverse_clips", { elementIds: [ref("media.created.0")] }),
    step("reversedClip", "get_clip", { elementId: ref("media.created.0") }),
    step("unreverse", "unreverse_clips", { elementIds: [ref("media.created.0")] }),
    step("ramp", "set_speed_curve", { elementId: ref("media.created.0"), points: [{ t: 0, v: 0.5 }, { t: 1500, v: 2 }, { t: 3000, v: 1 }], ripple: true }),
    step("rampClip", "get_clip", { elementId: ref("media.created.0") }),
    step("undoRamp", "undo"),
    step("captions", "import_subtitles", { paths: [at("korean.srt")] }),
    step("subtitleOut", "export_subtitles", { path: at("roundtrip.srt"), overwrite: true }),
    step("slotTitle", "add_text", { text: "바꿀 수 있는 제목", startMs: 2000, durationMs: 1000 }),
    step("markText", "mark_template_slots", { elementIds: [ref("slotTitle.created.0")], label: "제목" }),
    step("markMedia", "mark_template_slots", { elementIds: [ref("media.created.0")], label: "영상" }),
    step("templateOut", "export_template", { path: at("audit.cttpl"), name: "나래 CLI 검증", author: "Narae tests", overwrite: true }),
    step("install", "install_template", { path: at("audit.cttpl") }),
    step("placed", "add_template", { templateId: ref("install.id"), startMs: 3000 }),
    step("detail", "get_template_detail", { elementId: ref("placed.elementId") }),
    step("fillText", "set_template_fill", { elementId: ref("placed.elementId"), slotId: ref("markText.slots.0.slotId"), fill: { kind: "text", text: "만승초등학교" } }),
    step("filledDetail", "get_template_detail", { elementId: ref("placed.elementId") }),
    step("expand", "expand_template", { elementId: ref("placed.elementId") }),
    step("compositions", "list_compositions"),
    step("main", "switch_timeline", { timelineId: "main" }),
    step("closeComposition", "close_timeline", { timelineId: ref("expand.compositionId") }),
    step("templates", "list_templates"),
    step("proxies", "generate_proxies", { sources: [at("video-a.mp4")], force: true }),
    step("proxyMode", "set_proxy_mode", { mode: "prefer" }),
    step("proxyStatus", "get_proxy_status"),
    step("clips", "list_clips", { limit: 100 }),
  ], saveProject: at("parity.nmm"), overwrite: true,
});

write("reopen.job.json", {
  version: 1, project: at("visual.nmm"),
  steps: [step("overview", "get_project_overview"), step("clips", "list_clips", { limit: 100 })],
  saveProject: at("visual-reopened.nmm"), overwrite: true,
});

write("fixture-manifest.json", {
  generator: "tests/narae/create-fixtures.mjs", ffmpeg, generatedAt: new Date().toISOString(),
  jobs: ["inventory", "visual", "editing", "graphics", "parity", "reopen"].map((name) => at(`${name}.job.json`)),
  note: "Synthetic audit media. No external API, current GUI project or user media is changed. Run reopen after visual. Runtime success requires result verification.",
});
console.log(JSON.stringify({ ok: true, directory: out, jobs: 6 }));
