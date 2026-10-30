import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MessageChannel } from "node:worker_threads";
import { useTimelineStore } from "../../../states/timelineStore";
import { timelineLockStore } from "../../../states/timelineLockStore";
import { selectionStore } from "../../../states/selectionStore";
import { SCHEMA_VERSION, createTrack, normalizeDocument } from "../../timeline/tracks";
import { videoElement, textElement } from "../../renderer/testing";
import { getCommand } from "../registry";
import { spanOf } from "../../timeline/geometry";
import { runBatch } from "../../extension/transaction";
import { installExtensionBridge, invokeContributedCommand, runContributedCommand } from "../../extension/bridge";
import { contributionStore } from "../../extension/contributions";
import { createRpcEndpoint, RpcError } from "../../extension/shared";
import "./naraeParity";
import "./meta";

const run = async (name: string, params: any = {}): Promise<any> => {
  const command = getCommand(name);
  if (command == null) throw new Error(`Missing command ${name}`);
  return command(params);
};
function doc() { return useTimelineStore.getState().getDocument(); }
function seed() {
  useTimelineStore.getState().clearTimeline();
  useTimelineStore.getState().patchDocument(normalizeDocument({
    schemaVersion: SCHEMA_VERSION,
    tracks: [createTrack("video", "video", 0), createTrack("text", "text", 1)],
    elements: {
      v: videoElement({ key: "v", trackId: "video", localpath: "file://C:/media/source.mp4", startTime: 0,
        duration: 4000, sourceDuration: 8000, trim: { startTime: 1000, endTime: 5000 }, speed: 1 }),
      a: textElement({ key: "a", trackId: "text", startTime: 0, duration: 1000, text: "첫 번째" }),
      b: textElement({ key: "b", trackId: "text", startTime: 1000, duration: 1000, text: "두 번째" }),
    },
  }));
}

describe("Narae parity commands", () => {
  beforeEach(() => { timelineLockStore.getState().unlock(); seed(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sets a speed ramp and restores the initial state in one undo", async () => {
    const before = doc().elements.v;
    const result = await run("set_speed_curve", { elementId: "v", points: [{ t: 1000, v: 1 }, { t: 5000, v: 2 }], ripple: true });
    expect(result.ok).toBe(true);
    expect((doc().elements.v as any).speedCurve).toHaveLength(2);
    expect((await run("undo")).ok).toBe(true);
    expect(doc().elements.v).toEqual(before);
  });

  it("awaits reverse encoding, then restores the exact source and trim", async () => {
    let finish!: (value: unknown) => void;
    const start = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("window", { electronAPI: { req: { reverse: { start } } } });
    const before = doc().elements.v;
    const pending = run("reverse_clips", { elementIds: ["v"] });
    expect(start).toHaveBeenCalledWith(expect.any(String), { source: "C:/media/source.mp4", fromMs: 1000, toMs: 5000 });
    expect(doc().elements.v).toBe(before);
    finish({ ok: true, path: "C:/cache/reversed.mp4", durationMs: 4000, hasAudio: true });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect((doc().elements.v as any).localpath).toBe("file://C:/cache/reversed.mp4");
    expect(spanOf(doc().elements.v)).toEqual(spanOf(before));
    expect((await run("unreverse_clips", { elementIds: ["v"] })).ok).toBe(true);
    expect((doc().elements.v as any).localpath).toBe((before as any).localpath);
    expect((doc().elements.v as any).trim).toEqual((before as any).trim);
  });

  it("does not mutate history or clips when reversal fails", async () => {
    vi.stubGlobal("window", { electronAPI: { req: { reverse: { start: async () => ({ ok: false, error: "encoder failed" }) } } } });
    const before = doc();
    const history = useTimelineStore.getState().history;
    const result = await run("reverse_clips", { elementIds: ["v"] });
    expect(result).toMatchObject({ ok: false, generated: 0, failed: [{ elementId: "v", error: "encoder failed" }] });
    expect(doc().elements).toBe(before.elements);
    expect(useTimelineStore.getState().history).toBe(history);
  });

  it("exports an explicit subtitle scope independently of GUI selection and awaits the write", async () => {
    const write = vi.fn(async () => ({ status: true }));
    vi.stubGlobal("electronAPI", { req: { filesystem: { writeFileEnsured: write } } });
    selectionStore.getState().setIds(["a"]);
    const result = await run("export_subtitles", { path: "C:/output/test.vtt", elementIds: ["b"] });
    expect(result).toMatchObject({ ok: true, cues: 1, flavour: "vtt" });
    const content = Buffer.from(write.mock.calls[0][1], "base64").toString("utf8");
    expect(content).toContain("WEBVTT");
    expect(content).toContain("두 번째");
    expect(content).not.toContain("첫 번째");
  });

  it("preserves existing authored slot ids and does not add undo for repeat marking", async () => {
    const first = await run("mark_template_slots", { elementIds: ["v", "a"], replaceable: true, label: "교체" });
    expect(first.ok).toBe(true);
    const slotIds = first.slots.map((slot: any) => slot.slotId).sort();
    const history = useTimelineStore.getState().history;
    const repeat = await run("mark_template_slots", { elementIds: ["v", "a"], replaceable: true });
    expect(repeat.ok).toBe(false);
    expect(repeat.slots.map((slot: any) => slot.slotId).sort()).toEqual(slotIds);
    expect(useTimelineStore.getState().history).toBe(history);
  });

  it("hides a track undoably and refuses a locked timeline", async () => {
    expect((await run("set_track_hidden", { trackId: "video", hidden: true })).ok).toBe(true);
    expect(doc().tracks.find(track => track.id === "video")?.hidden).toBe(true);
    expect((await run("undo")).ok).toBe(true);
    expect(doc().tracks.find(track => track.id === "video")?.hidden).toBeUndefined();
    timelineLockStore.getState().lock("captionSession");
    const result = await run("set_track_hidden", { trackId: "video", hidden: true });
    expect(result.ok).toBe(false);
    expect(doc().tracks.find(track => track.id === "video")?.hidden).toBeUndefined();
  });

  it("refuses native and workspace operations before invoking them inside a batch", () => {
    const runCommand = vi.fn();
    for (const name of ["reverse_clips", "list_templates", "install_template", "add_template", "expand_template",
      "switch_timeline", "close_timeline", "export_template", "import_subtitles", "export_subtitles",
      "generate_proxies", "get_proxy_status", "set_proxy_mode", "get_template_detail", "set_template_fill",
      "list_extension_commands", "run_extension_command"]) {
      const result = runBatch([{ name }], {
        getDocument: doc, withCheckpoint: vi.fn(), ensureUndoBaseline: vi.fn(),
        isLocked: () => false, lockMessage: () => "locked", runCommand,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("cannot run inside a batch");
    }
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reports a missing extension host through the API instead of silent null", async () => {
    await expect(run("run_extension_command", { extensionId: "test.demo", commandId: "echo" }))
      .rejects.toThrow("extension host is not running");
  });

  it("lists runtime contributions and preserves extension results and RPC failures", async () => {
    let receivePort!: (event: any) => void;
    let receiveState!: (event: any, state: any) => void;
    const windowStub = {
      location: { protocol: "file:", hostname: "" },
      addEventListener: (event: string, listener: any) => { if (event === "message") receivePort = listener; },
      electronAPI: { req: { ext: { list: async () => [{ id: "test.demo", enabled: true }] } },
        res: { ext: { onHostState: (listener: any) => { receiveState = listener; } } } },
    };
    vi.stubGlobal("window", windowStub);
    const toast = vi.fn();
    vi.stubGlobal("document", { querySelector: () => ({ showToast: toast }) });
    installExtensionBridge();
    const channel = new MessageChannel();
    const host = createRpcEndpoint({
      postMessage: message => channel.port2.postMessage(message),
      onMessage: listener => { channel.port2.onmessage = event => listener(event.data); },
      start: () => channel.port2.start(), close: () => channel.port2.close(),
    }, { request: request => {
      const args: any = request.params;
      expect(request.method).toBe("commands.invoke");
      if (args.command === "fail") throw new RpcError("E_DECLINED", "extension failed deliberately");
      return args.command === "nullResult" ? null : args.args;
    } });
    try {
      receivePort({ source: windowStub, data: { type: "ext:port", generation: 1 }, ports: [channel.port1] });
      receiveState(null, { state: "ready", crashes: 0, lastError: null });
      contributionStore.getState().applyHello([{
        id: "test.demo", version: "1.0.0", displayName: "Test", permissions: [],
        contributes: { commands: [{ id: "echo", title: "Echo" }, { id: "fail", title: "Fail" }, { id: "nullResult", title: "Null result" }] },
      }] as any);
      const listing = await run("list_extension_commands");
      expect(listing).toMatchObject({ connected: true, host: { state: "ready" }, installed: [{ id: "test.demo" }] });
      expect(listing.commands.map((command: any) => command.commandId)).toEqual(["echo", "fail", "nullResult"]);
      await expect(invokeContributedCommand("test.demo", "missing")).rejects.toThrow("No contributed extension command");
      expect(await run("run_extension_command", { extensionId: "test.demo", commandId: "echo", args: { text: "한글" } }))
        .toMatchObject({ ok: true, result: { text: "한글" } });
      expect(await run("run_extension_command", { extensionId: "test.demo", commandId: "nullResult" }))
        .toMatchObject({ ok: true, result: null });
      await expect(run("run_extension_command", { extensionId: "test.demo", commandId: "fail" }))
        .rejects.toThrow("extension failed deliberately");
      expect(await runContributedCommand("test.demo", "fail")).toBeNull();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("extension failed deliberately") }));
    } finally {
      receiveState(null, { state: "stopped", crashes: 0, lastError: null });
      host.dispose();
      channel.port1.close(); channel.port2.close();
    }
  });
});
