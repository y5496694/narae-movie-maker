import JSZip from "jszip";
import project from "../functions/project";
import { useTimelineStore } from "../states/timelineStore";
import { renderOptionStore } from "../states/renderOptionStore";
import { previewViewportStore } from "../states/previewViewportStore";
import { exportStore } from "../states/exportStore";
import { projectSnapshot } from "./composition/projectSnapshot";
import { serializeProjectEntries } from "./project/projectEntries";
import { buildNgtBlob, readNgtEntries } from "./project/projectArchive";
import { readProjectDocument, readProjectFailureMessage } from "./project/projectDocument";
import { compositionsExtraEntries } from "./project/compositionsFile";
import { timelineViewExtraEntries } from "../states/trackHeightStore";
import { extensionsExtraEntries } from "./extension/projectDataStore";
import { markProjectSaved } from "./project/projectDirty";
import { registerPickedFile, registeredMedia } from "./asset/webMedia/mediaRegistry";
import { startExport, cancelExport, getExportOutcome } from "./export/exportSession";

// Enabled only by the same-origin Narae Tube host. No identity token enters this frame.
export function installNaraeTubeStudio() {
  if (!new URLSearchParams(location.search).has("naraeTube") || window.parent === window) return;
  try { if (window.parent.location.origin !== location.origin) return; } catch { return; }
  const host = window as any;
  let delivered: { blob: Blob; name: string } | null = null;
  let rendering = false;
  const maxBytes = 512 * 1024 * 1024;
  host.naraeTubeDeliverOutput = (blob: Blob, name: string) => {
    if (blob.size > maxBytes) throw new Error("완성 영상은 512MB 이하로 출력해주세요.");
    delivered = { blob, name };
    window.parent.dispatchEvent(new CustomEvent("narae-studio-output"));
  };
  let lastDocument = "";
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      const document = JSON.stringify(projectSnapshot());
      if (document !== lastDocument) {
        lastDocument = document;
        window.parent.dispatchEvent(new CustomEvent("narae-studio-change"));
      }
    }, 500);
  };
  useTimelineStore.subscribe(changed);
  renderOptionStore.subscribe((state, previous) => {
    const nextSize = state.options.previewSize, oldSize = previous.options.previewSize;
    if (nextSize.w !== oldSize.w || nextSize.h !== oldSize.h) previewViewportStore.getState().fit(nextSize.w, nextSize.h);
    changed();
  });
  host.naraeTubeEditor = {
    engine: "나래 무비메이커 웹 엔진",
    status: () => ({ ...exportStore.getState(), rendering, outcome: getExportOutcome() }),
    snapshot: () => projectSnapshot(),
    output: () => delivered,
    cancel: () => cancelExport(),
    async render() {
      if (rendering) throw new Error("영상 생성이 이미 진행 중입니다.");
      rendering = true;
      delivered = null;
      renderOptionStore.getState().updateExportSettings({ container: "mp4", videoCodec: "h264", audioCodec: "aac" });
      try {
        await startExport();
        if (!delivered) throw new Error(getExportOutcome()?.ok === false ? (getExportOutcome() as any).error : "영상 생성이 취소되었거나 이 브라우저에서 지원되지 않습니다.");
        return delivered;
      } finally { rendering = false; }
    },
    async archive(): Promise<Blob> {
      const snap = projectSnapshot();
      const entries = serializeProjectEntries({ elements: snap.project.main.elements, tracks: snap.project.main.tracks, options: snap.options, anchor: "studio.nmm", compositionCount: Object.keys(snap.project.compositions).length });
      const blob = await buildNgtBlob(entries, { ...compositionsExtraEntries(snap.project.compositions, "studio.nmm"), ...timelineViewExtraEntries(snap.tracks), ...extensionsExtraEntries() });
      const zip = await JSZip.loadAsync(blob);
      const paths = new Set<string>();
      const visit = (value: any) => {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === "string" && child.startsWith("blob:")) paths.add(child);
          else if (child && typeof child === "object") visit(child);
        }
      };
      visit(snap.project);
      const media: any[] = [];
      let total = blob.size;
      for (const localpath of paths) {
        const item = registeredMedia(localpath);
        if (!item) throw new Error("프로젝트의 원본 파일을 찾을 수 없습니다. 파일을 다시 선택해주세요.");
        total += item.file.size;
        if (total > maxBytes) throw new Error("프로젝트와 원본 파일은 합계 512MB까지 저장할 수 있습니다.");
        const entry = `studio-media/${media.length}`;
        zip.file(entry, item.file);
        media.push({ localpath, entry, name: item.name, type: item.file.type });
      }
      zip.file("narae-studio.json", JSON.stringify({ version: 1, media }));
      const result = await zip.generateAsync({ type: "blob", compression: "STORE" });
      if (result.size > maxBytes) throw new Error("프로젝트 보관 용량을 초과했습니다.");
      return result;
    },
    async open(blob: Blob) {
      if (rendering) throw new Error("영상 생성이 끝난 뒤 프로젝트를 열어주세요.");
      if (blob.size > maxBytes) throw new Error("프로젝트가 너무 큽니다.");
      const zip = await JSZip.loadAsync(blob);
      const allEntries = Object.values(zip.files);
      if (allEntries.length > 1500 || allEntries.reduce((n, entry: any) => n + (entry._data?.uncompressedSize || 0), 0) > maxBytes) throw new Error("프로젝트 보관 용량을 초과했습니다.");
      const manifest = zip.file("narae-studio.json");
      const mapping = new Map<string, string>();
      if (manifest) {
        const data = JSON.parse(await manifest.async("string"));
        if (data.version !== 1 || !Array.isArray(data.media) || data.media.length > 1000) throw new Error("프로젝트 형식을 확인해주세요.");
        let total = 0;
        for (const item of data.media) {
          if (typeof item.entry !== "string" || !/^studio-media\/\d+$/.test(item.entry)) throw new Error("잘못된 미디어 항목입니다.");
          const packed = zip.file(item.entry);
          if (!packed) throw new Error("프로젝트 원본 파일이 누락되었습니다.");
          const bytes = await packed.async("uint8array");
          total += bytes.byteLength;
          if (total > maxBytes) throw new Error("프로젝트 보관 용량을 초과했습니다.");
          mapping.set(item.localpath, registerPickedFile(new File([bytes], String(item.name), { type: String(item.type) })));
        }
      }
      const remap = (v: any): any => typeof v === "string" ? mapping.get(v) ?? v : Array.isArray(v) ? v.map(remap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)])) : v;
      for (const name of ["timeline.json", "compositions.json"]) {
        const entry = zip.file(name);
        if (entry) zip.file(name, JSON.stringify(remap(JSON.parse(await entry.async("string")))));
      }
      zip.file("assetPaths.json", "{}");
      const entries = await readNgtEntries(zip);
      const extra = async (name: string) => zip.file(name)?.async("string") ?? null;
      const compositions = await extra("compositions.json");
      const read = await readProjectDocument(entries, "studio.nmm", async p => !p.startsWith("blob:") || registeredMedia(p) != null, compositions);
      if (!read.ok) throw new Error(readProjectFailureMessage(read));
      if (read.missing) throw new Error("프로젝트 원본을 찾을 수 없습니다. 원본 포함 스튜디오 프로젝트를 선택해주세요.");
      project.adoptDocument(read, "studio.nmm", { compositions, timelineView: await extra("timelineView.json"), extensions: await extra("extensions.json") });
      clearTimeout(changeTimer);
      lastDocument = JSON.stringify(projectSnapshot());
      markProjectSaved();
      delivered = null;
    },
  };
  // Desktop filesystem actions have explicit counterparts in the enclosing studio.
  const req = window.electronAPI.req as any;
  req.project.save = async () => { window.parent.dispatchEvent(new CustomEvent("narae-studio-save")); return "none"; };
  req.store.get = async (key: string) => { try { return { value: JSON.parse(localStorage.getItem("narae-studio:pref:" + key) || "null") }; } catch { return { value: null }; } };
  req.store.set = async (key: string, value: unknown) => { localStorage.setItem("narae-studio:pref:" + key, JSON.stringify(value)); return true; };
  req.filesystem.getDirectory = async () => [];
  req.app.getAppInfo = async () => ({ data: { version: "나래튜브 스튜디오" } });
  window.parent.dispatchEvent(new CustomEvent("narae-studio-ready"));
}
