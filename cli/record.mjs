import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

const COMMANDS = new Set(["devices", "record-screen", "record-camera", "record-audio"]);
const FLAGS = new Set(["--overwrite", "--dry-run", "--help", "-h"]);
const VALUES = new Set(["--output", "--seconds", "--audio-device", "--video-device", "--fps", "--region"]);
const LOG_LIMIT = 65536;

export const RECORDING_HELP = `독립 FFmpeg 녹화 명령
  devices [--dry-run]
  record-screen --output FILE --seconds N [--audio-device NAME]
  record-camera --video-device NAME --output FILE --seconds N [--audio-device NAME]
  record-audio --audio-device NAME --output FILE --seconds N

공통: --dry-run, --overwrite, --help
영상: --fps 30 또는 30000/1001
화면 영역: --region X,Y,WIDTH,HEIGHT
화면 선택: Windows는 desktop 또는 title=창이름, Linux는 X11 DISPLAY,
macOS는 devices에 나온 Capture screen의 이름 또는 번호를 --video-device로 지정합니다.
Windows 장치는 devices에 표시된 정확한 DirectShow 이름을 사용합니다.
영상 출력: .mp4 .mov .mkv .webm
음성 출력: .wav .flac .mp3 .m4a .aac .mp4 .ogg .opus .mkv
기존 파일은 --overwrite를 지정할 때만 덮어씁니다.
--dry-run은 녹화나 파일 생성 없이 실행할 인수 배열을 반환합니다.
Ctrl+C 또는 호출자의 AbortSignal로 이 명령이 시작한 FFmpeg만 중지합니다.`;

function parseArgs(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== "string")) {
    throw new TypeError("녹화 인수는 문자열 배열이어야 합니다.");
  }
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const raw = args[index];
    const equal = raw.indexOf("=");
    const flag = equal > 0 ? raw.slice(0, equal) : raw;
    if (FLAGS.has(flag)) {
      if (equal > 0) throw new Error(`${flag}에는 값을 지정하지 않습니다.`);
      if (result[flag]) throw new Error(`중복 인수: ${flag}`);
      result[flag] = true;
    } else if (VALUES.has(flag)) {
      const value = equal > 0 ? raw.slice(equal + 1) : args[++index];
      if (value == null || value.length === 0 || value.startsWith("--")) {
        throw new Error(`${flag} 값이 필요합니다.`);
      }
      if (result[flag] !== undefined) throw new Error(`중복 인수: ${flag}`);
      if (/[\0\r\n]/u.test(value)) throw new Error(`${flag}에 제어 문자를 사용할 수 없습니다.`);
      result[flag] = value;
    } else if (!raw.startsWith("-") && result["--output"] === undefined) {
      if (/[\0\r\n]/u.test(raw)) throw new Error("출력 경로에 제어 문자를 사용할 수 없습니다.");
      result["--output"] = raw;
    } else {
      throw new Error(`알 수 없는 녹화 인수: ${raw}`);
    }
  }
  return result;
}

function finiteSeconds(value) {
  if (value === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value)) {
    throw new Error("--seconds에 유한한 양수 시간을 지정하세요.");
  }
  const seconds = Number(value);
  if (!(seconds > 0) || !Number.isSafeInteger(Math.ceil(seconds * 1000))) {
    throw new Error("--seconds에 안전하게 표현할 수 있는 유한한 양수 시간을 지정하세요.");
  }
  return seconds;
}

function frameRate(value = "30") {
  if (!/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/u.test(value)) {
    throw new Error("--fps는 1~240의 수 또는 30000/1001 같은 비율이어야 합니다.");
  }
  const [numerator, denominator = "1"] = value.split("/");
  const rate = Number(numerator) / Number(denominator);
  if (!Number.isFinite(rate) || rate < 1 || rate > 240) {
    throw new Error("--fps는 1~240이어야 합니다.");
  }
  return value;
}

function parseRegion(value) {
  if (value === undefined) return null;
  if (!/^-?\d+,-?\d+,\d+,\d+$/u.test(value)) {
    throw new Error("--region은 X,Y,WIDTH,HEIGHT 형식의 정수여야 합니다.");
  }
  const [x, y, width, height] = value.split(",").map(Number);
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 ||
      [x, y].some(item => item < -2147483648 || item > 2147483647) || width > 32768 || height > 32768) {
    throw new Error("녹화 영역의 좌표와 크기가 허용 범위를 벗어났습니다.");
  }
  return { x, y, width, height };
}

function deviceName(value, flag, platform) {
  if (!value || value.trim().length === 0) throw new Error(`${flag}에 장치를 명시하세요. devices로 이름을 확인할 수 있습니다.`);
  if ((platform === "win32" || platform === "darwin") && value.includes(":")) {
    throw new Error(`${flag}의 ':'는 FFmpeg 장치 구분자입니다. devices에 나온 대체 이름 또는 번호를 사용하세요.`);
  }
  return value;
}

function videoEncoding(extension) {
  if (![".mp4", ".mov", ".mkv", ".webm"].includes(extension)) {
    throw new Error("영상 출력 확장자는 .mp4, .mov, .mkv 또는 .webm을 사용하세요.");
  }
  return extension === ".webm"
    ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "5", "-b:v", "0", "-crf", "32"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
}

function audioEncoding(extension, video) {
  if (video) return extension === ".webm" ? ["-c:a", "libopus", "-b:a", "128k"] : ["-c:a", "aac", "-b:a", "192k"];
  if (extension === ".wav") return ["-c:a", "pcm_s16le"];
  if (extension === ".flac") return ["-c:a", "flac"];
  if (extension === ".mp3") return ["-c:a", "libmp3lame", "-b:a", "192k"];
  if ([".m4a", ".aac", ".mp4", ".mkv"].includes(extension)) return ["-c:a", "aac", "-b:a", "192k"];
  if ([".ogg", ".opus"].includes(extension)) return ["-c:a", "libopus", "-b:a", "128k"];
  throw new Error("음성 출력은 .wav, .flac, .mp3, .m4a, .aac, .mp4, .ogg, .opus 또는 .mkv를 사용하세요.");
}

/** Build arguments only. This function never starts a process or writes a file. */
export function buildRecordingInvocation(command, args, options = {}) {
  if (!COMMANDS.has(command)) throw new Error(`지원하지 않는 녹화 명령: ${command}`);
  const flags = parseArgs(args);
  if (flags["--help"] || flags["-h"]) return { help: RECORDING_HELP };
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const ffmpegPath = options.ffmpegPath;
  if (typeof ffmpegPath !== "string" || ffmpegPath.length === 0 || ffmpegPath.includes("\0")) {
    throw new Error("실행할 FFmpeg 경로가 필요합니다.");
  }
  if (!["win32", "linux", "darwin"].includes(platform)) throw new Error(`이 운영체제의 녹화는 지원하지 않습니다: ${platform}`);
  const dryRun = !!flags["--dry-run"];
  const argv = ["-hide_banner", "-nostats"];
  if (command === "devices") {
    const unexpected = Object.keys(flags).filter(flag => flag !== "--dry-run");
    if (unexpected.length) throw new Error(`devices에서 사용할 수 없는 인수: ${unexpected.join(", ")}`);
    const backend = platform === "win32" ? "dshow" : platform === "darwin" ? "avfoundation" : "pulse";
    argv.push(...(platform === "win32" ? ["-list_devices", "true", "-f", backend, "-i", "dummy"]
      : platform === "darwin" ? ["-f", backend, "-list_devices", "true", "-i", ""]
        : ["-sources", backend]));
    return { type: command, platform, backend, dryRun, command: [ffmpegPath, ...argv], capabilityCommand: [ffmpegPath, "-hide_banner", "-devices"] };
  }
  if (!flags["--output"] || flags["--output"] === "-") throw new Error("--output에 저장할 파일 경로를 명시하세요.");
  const seconds = finiteSeconds(flags["--seconds"]);
  const fps = frameRate(flags["--fps"]);
  const region = parseRegion(flags["--region"]);
  const video = command !== "record-audio";
  if (region && command !== "record-screen") throw new Error("--region은 record-screen에서만 사용할 수 있습니다.");
  if (!video && (flags["--video-device"] || flags["--fps"])) throw new Error("record-audio에서 --video-device와 --fps를 사용할 수 없습니다.");
  const output = path.resolve(options.cwd ?? process.cwd(), flags["--output"]);
  const extension = path.extname(output).toLowerCase();
  const overwrite = !!flags["--overwrite"];
  argv.push(overwrite ? "-y" : "-n");
  const input = (...values) => argv.push("-thread_queue_size", "512", ...values);
  let backend;
  let audioInput = null;
  let crop = null;

  if (platform === "win32") {
    if (command === "record-screen") {
      backend = "gdigrab";
      const source = flags["--video-device"] ?? "desktop";
      if (source !== "desktop" && !/^title=.+/u.test(source)) throw new Error("Windows 화면은 --video-device desktop 또는 title=창이름을 사용하세요.");
      const geometry = region ? ["-offset_x", String(region.x), "-offset_y", String(region.y), "-video_size", `${region.width}x${region.height}`] : [];
      input("-f", backend, "-framerate", fps, ...geometry, "-i", source);
    } else if (video) {
      backend = "dshow";
      const camera = deviceName(flags["--video-device"], "--video-device", platform);
      input("-f", backend, "-rtbufsize", "256M", "-framerate", fps, "-i", `video=${camera}`);
    } else {
      backend = "dshow";
    }
    if (flags["--audio-device"] || !video) {
      const audio = deviceName(flags["--audio-device"], "--audio-device", platform);
      input("-f", "dshow", "-i", `audio=${audio}`);
      audioInput = video ? 1 : 0;
    }
  } else if (platform === "linux") {
    if (command === "record-screen") {
      backend = "x11grab";
      const display = flags["--video-device"] ?? environment.DISPLAY;
      if (!display || !/^(?:[^\s+:]+)?:\d+(?:\.\d+)?$/u.test(display)) {
        throw new Error("Linux 화면 녹화에는 DISPLAY 또는 --video-device :0.0 같은 X11 표시 주소가 필요합니다.");
      }
      const geometry = region ? ["-video_size", `${region.width}x${region.height}`] : [];
      const source = region ? `${display}+${region.x},${region.y}` : display;
      input("-f", backend, "-framerate", fps, ...geometry, "-i", source);
    } else if (video) {
      backend = "v4l2";
      const camera = deviceName(flags["--video-device"], "--video-device", platform);
      if (!/^\/dev\/video\d+$/u.test(camera)) throw new Error("Linux 카메라는 --video-device /dev/video0 형식으로 지정하세요.");
      input("-f", backend, "-framerate", fps, "-i", camera);
    } else {
      backend = "pulse";
    }
    if (flags["--audio-device"] || !video) {
      const audio = deviceName(flags["--audio-device"], "--audio-device", platform);
      input("-f", "pulse", "-i", audio);
      audioInput = video ? 1 : 0;
    }
  } else {
    backend = "avfoundation";
    const source = video ? deviceName(flags["--video-device"], "--video-device", platform) : "none";
    if (command === "record-screen" && !/^\d+$/u.test(source) && !/^Capture screen \d+$/iu.test(source)) {
      throw new Error("macOS 화면에는 devices에 나온 Capture screen 이름 또는 번호를 지정하세요.");
    }
    const audio = flags["--audio-device"] || !video ? deviceName(flags["--audio-device"], "--audio-device", platform) : "none";
    if (video && source === "none") throw new Error("영상 입력 장치에 none을 사용할 수 없습니다.");
    if (audio === "none" && !video) throw new Error("녹음 입력 장치에 none을 사용할 수 없습니다.");
    input("-f", backend, ...(video ? ["-framerate", fps] : []), "-i", `${source}:${audio}`);
    if (audio !== "none") audioInput = 0;
    if (region) {
      if (region.x < 0 || region.y < 0) throw new Error("macOS 화면 영역의 X, Y는 0 이상이어야 합니다.");
      crop = `crop=${region.width}:${region.height}:${region.x}:${region.y}`;
    }
  }

  argv.push("-t", String(seconds));
  if (video) {
    argv.push("-map", "0:v:0", ...videoEncoding(extension), "-pix_fmt", "yuv420p");
    argv.push("-vf", [crop, "pad=ceil(iw/2)*2:ceil(ih/2)*2"].filter(Boolean).join(","));
  }
  if (audioInput !== null) argv.push("-map", `${audioInput}:a:0`, ...audioEncoding(extension, video));
  else argv.push("-an");
  if ([".mp4", ".mov", ".m4a"].includes(extension)) argv.push("-movflags", "+faststart");
  argv.push(output);
  return { type: command, platform, backend, output, seconds, fps: video ? fps : undefined, region, overwrite, dryRun, command: [ffmpegPath, ...argv] };
}

function appendTail(previous, data) {
  return (previous + data.toString("utf8")).slice(-LOG_LIMIT);
}

function runOwnProcess(command, { signal, timeoutMs }) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error("녹화 요청이 이미 취소되었습니다."), { code: "ABORT_ERR" }));
  return new Promise((resolve, reject) => {
    const [executable, ...args] = command;
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", cancelled = false, timedOut = false, closed = false;
    const timers = new Set();
    const later = (action, delay) => { const timer = setTimeout(() => { timers.delete(timer); action(); }, delay); timers.add(timer); return timer; };
    const stop = (timeout = false) => {
      if (cancelled || closed) return;
      cancelled = true;
      timedOut = timeout;
      if (!child.stdin.destroyed) child.stdin.write("q\n");
      later(() => { if (!closed) child.kill("SIGTERM"); }, 3000);
      later(() => { if (!closed) child.kill("SIGKILL"); }, 6000);
    };
    const interrupt = () => stop(false);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    signal?.addEventListener("abort", interrupt, { once: true });
    const deadline = Date.now() + timeoutMs;
    const armDeadline = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) stop(true);
      else later(armDeadline, Math.min(remaining, 2147483647));
    };
    armDeadline();
    const cleanup = () => {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      signal?.removeEventListener("abort", interrupt);
    };
    child.stdin.on("error", () => {});
    child.stdout.on("data", data => { stdout = appendTail(stdout, data); });
    child.stderr.on("data", data => { stderr = appendTail(stderr, data); });
    child.on("error", error => { cleanup(); reject(error); });
    child.on("close", (exitCode, exitSignal) => { cleanup(); resolve({ exitCode, signal: exitSignal, stdout, stderr, cancelled, timedOut }); });
    if (signal?.aborted) interrupt();
  });
}

function parseDeviceListing(text, platform) {
  const devices = [];
  let kind = null;
  for (const line of text.split(/\r?\n/u)) {
    if (/video devices:/iu.test(line)) kind = "video";
    if (/audio devices:/iu.test(line)) kind = "audio";
    if (platform === "win32") {
      const match = line.match(/\] "(.*)"(?: \((video|audio)\))?\s*$/u);
      if (match && (match[2] || kind) && !line.includes("Alternative name")) {
        devices.push({ kind: match[2] ?? kind, id: match[1], name: match[1] });
      } else {
        const alternate = line.match(/Alternative name "(.*)"/u);
        if (alternate && devices.length) devices[devices.length - 1].alternativeId = alternate[1];
      }
    } else if (platform === "darwin") {
      const match = line.match(/\]\s+\[(\d+)\]\s+(.+)$/u);
      if (match && kind) devices.push({ kind: /^Capture screen \d+/iu.test(match[2]) ? "screen" : kind, id: match[1], name: match[2] });
    } else {
      const match = line.match(/^\s*\*?\s*(\S+)\s+\[([^\]]+)\]/u);
      if (match) devices.push({ kind: "audio", id: match[1], name: match[2] });
    }
  }
  return devices;
}

/** Execute one bounded recording or enumerate devices, without an editor process. */
export async function runRecordingCommand(command, args, options = {}) {
  const invocation = buildRecordingInvocation(command, args, options);
  if (invocation.help || invocation.dryRun) return invocation;
  if (options.signal?.aborted) throw Object.assign(new Error("녹화 요청이 이미 취소되었습니다."), { code: "ABORT_ERR" });
  if (command === "devices") {
    const capabilities = await runOwnProcess(invocation.capabilityCommand, { signal: options.signal, timeoutMs: 15000 });
    if (capabilities.cancelled) return { ...invocation, ...capabilities, devices: [] };
    const formats = new Set();
    for (const line of `${capabilities.stdout}\n${capabilities.stderr}`.split(/\r?\n/u)) {
      const match = line.match(/^\s*D[ E.]*\s+(\S+)/u);
      if (match) for (const name of match[1].split(",")) formats.add(name);
    }
    const backends = invocation.platform === "win32" ? { screen: formats.has("gdigrab"), camera: formats.has("dshow"), audio: formats.has("dshow") }
      : invocation.platform === "darwin" ? { screen: formats.has("avfoundation"), camera: formats.has("avfoundation"), audio: formats.has("avfoundation") }
        : { screen: formats.has("x11grab"), camera: formats.has("v4l2") || formats.has("video4linux2"), audio: formats.has("pulse") };
    const canList = formats.has(invocation.backend);
    const result = canList ? await runOwnProcess(invocation.command, { signal: options.signal, timeoutMs: 15000 })
      : { exitCode: null, stdout: "", stderr: `FFmpeg에 ${invocation.backend} 입력이 포함되지 않았습니다.`, cancelled: false };
    if (result.cancelled) return { ...invocation, ...result, devices: [], backends };
    const raw = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const devices = parseDeviceListing(raw, invocation.platform);
    if (invocation.platform === "win32" && backends.screen) devices.unshift({ kind: "screen", id: "desktop", name: "Windows desktop (gdigrab)" });
    if (invocation.platform === "linux") {
      if (backends.screen && (options.env ?? process.env).DISPLAY) devices.unshift({ kind: "screen", id: (options.env ?? process.env).DISPLAY, name: "X11 display" });
      try {
        for (const name of await readdir("/dev")) {
          if (backends.camera && /^video\d+$/u.test(name)) devices.push({ kind: "video", id: `/dev/${name}`, name });
        }
      } catch {}
    }
    const unavailable = /Unknown input format|Unknown input device|Device not found|not compiled|Unrecognized option/iu.test(raw);
    return { ...invocation, devices, backends, available: canList && !unavailable, exitCode: result.exitCode, diagnostics: raw };
  }
  let existing;
  try { existing = await lstat(invocation.output); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing?.isSymbolicLink()) throw new Error("녹화 출력 경로에 심볼릭 링크를 사용할 수 없습니다.");
  if (existing && !existing.isFile()) throw new Error("녹화 출력 경로는 일반 파일이어야 합니다.");
  if (existing && !invocation.overwrite) throw new Error(`출력 파일이 이미 있습니다. --overwrite가 필요합니다: ${invocation.output}`);
  await mkdir(path.dirname(invocation.output), { recursive: true });
  const result = await runOwnProcess(invocation.command, { signal: options.signal, timeoutMs: invocation.seconds * 1000 + 30000 });
  if (result.timedOut) throw Object.assign(new Error(`FFmpeg 녹화가 제한 시간에 종료되지 않았습니다. ${result.stderr.slice(-5000)}`), { code: "RECORDING_TIMEOUT", output: invocation.output });
  if (!result.cancelled && result.exitCode !== 0) {
    throw Object.assign(new Error(`FFmpeg 녹화 실패 (${result.exitCode}): ${result.stderr.slice(-5000)}`), { code: "RECORDING_FAILED", output: invocation.output });
  }
  const outputInfo = await stat(invocation.output).catch(() => null);
  if (!result.cancelled && (!outputInfo?.isFile() || outputInfo.size === 0)) throw new Error("FFmpeg가 유효한 녹화 파일을 생성하지 않았습니다.");
  return { ...invocation, cancelled: result.cancelled, exitCode: result.exitCode, bytes: outputInfo?.size ?? 0, diagnostics: result.stderr };
}
