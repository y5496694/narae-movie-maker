/** Dialog-free access to the editor's existing speed, reverse, template and subtitle operations. */
import { v4 as uuidv4 } from "uuid";
import { useTimelineStore } from "../../../states/timelineStore";
import { contentOfState } from "../../../states/timelineWorkspace";
import { proxyStore } from "../../../states/proxyStore";
import { renderOptionStore } from "../../../states/renderOptionStore";
import { arrayBufferToBase64 } from "../../../utils/base64";
import { setClipSpeedCurve } from "../../timeline/speedOps";
import { applyReverse, reverseSnapshotOf, unreverseMany } from "../../timeline/reverseOps";
import { toLocalPathKey, toOsPath } from "../../proxy/proxyPath";
import { refreshProxies } from "../../proxy/proxyBridge";
import { installedTemplates, refreshTemplateLibrary, loadTemplate, templateListing } from "../../template/templateRegistry";
import { installTemplateArchive } from "../../template/templateInstall";
import { addTemplate, createTemplateElement, setTemplateFill, setTemplateFillOffset, setReplaceable, clearReplaceable } from "../../timeline/templateOps";
import { setTrackHidden } from "../../timeline/tracks";
import { slotsOf } from "../../template/slots";
import { probeMedia } from "../../element/mediaProbe";
import type { TemplateElementType, TemplateFill } from "../../../@types/timeline";
import { snapMsToFrame } from "../../timeline/frames";
import { canHoldTemplates, NESTED_TEMPLATE_MESSAGE } from "../../composition/nesting";
import { buildTemplateArchive, templateNameFrom } from "../../template/templateExport";
import { expandTemplate } from "../../composition/expandTemplate";
import { requestCloseTimelineTab, requestTimelineSwitch } from "../../composition/navigation";
import { MAIN_TIMELINE } from "../../composition/project";
import { projectRenderOptions } from "../../composition/projectSnapshot";
import { serializeRenderOptions } from "../../project/renderOptionsFile";
import { importSubtitlePaths } from "../../subtitle/importSubtitleFile";
import { cuesFromDocument } from "../../subtitle/exportCues";
import { serializeSubtitles } from "../../subtitle/serialize";
import { flavourForPath, writeSubtitleFile } from "../../subtitle/subtitleFile";
import { isDynamicElement } from "../../timeline/geometry";
import { activeTransaction } from "../../extension/transaction";
import { invokeContributedCommand, isExtensionHostConnected } from "../../extension/bridge";
import { contributionStore } from "../../extension/contributions";
import { hostStateStore } from "../../extension/hostState";
import { isTimelineLocked } from "../../../states/timelineLockStore";
import { commit, LOCKED_REASON } from "../commit";
import { currentDoc, requireElement, requireTrack } from "../context";
import { registerCommands } from "../registry";

function api(): any {
  const request = (window as any).electronAPI?.req;
  if (request == null) throw new Error("The native media engine is unavailable.");
  return request;
}

// These operations perform asynchronous native work or change the active workspace.
// A document transaction cannot safely contain them; regular run_job steps can.
function outsideBatch(): void {
  if (activeTransaction() != null) throw new Error("Run this operation as a separate job step, outside batch_edit.");
}

function editable(): void {
  outsideBatch();
  if (isTimelineLocked()) throw new Error(LOCKED_REASON);
}

function knownTimeline(id: string): void {
  const state = useTimelineStore.getState();
  if (id !== MAIN_TIMELINE && state.compositions[id] == null) throw new Error(`No timeline with id "${id}".`);
}

registerCommands({
  set_speed_curve: (params) => {
    requireElement(currentDoc(), params.elementId);
    return commit(doc => setClipSpeedCurve(doc, params.elementId, params.points, { ripple: params.ripple }),
      "The speed curve is invalid, unchanged, or would overlap another clip.");
  },

  reverse_clips: async (params) => {
    editable();
    const timelineId = useTimelineStore.getState().activeTimelineId;
    const doc = currentDoc();
    const snapshots = [...new Set<string>(params.elementIds)].map(elementId => {
      const snapshot = reverseSnapshotOf(requireElement(doc, elementId));
      if (snapshot == null) throw new Error(`Clip "${elementId}" is not a forward video with a valid trim window.`);
      return { elementId, snapshot };
    });
    const finished: any[] = [];
    const failed: { elementId: string; error: string }[] = [];
    // Await every generation: a headless process must not exit with files half written.
    for (const entry of snapshots) {
      try {
        const result = await api().reverse.start(uuidv4(), {
          source: toOsPath(entry.snapshot.localpath),
          fromMs: entry.snapshot.trim.startTime, toMs: entry.snapshot.trim.endTime,
        });
        if (!result?.ok) {
          failed.push({ elementId: entry.elementId, error: result?.error ?? (result?.cancelled ? "Cancelled." : "Reverse failed.") });
        } else {
          finished.push({ ...entry, result: {
            localpath: entry.snapshot.localpath.startsWith("file://") ? toLocalPathKey(result.path) : result.path,
            durationMs: result.durationMs, hasAudio: result.hasAudio,
          } });
        }
      } catch (error) {
        failed.push({ elementId: entry.elementId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (finished.length === 0) return { ok: false, failed, generated: 0 };
    const edit = commit(document => finished.reduce((next, entry) =>
      applyReverse(next, entry.elementId, entry.snapshot, entry.result), document),
      "The clips changed or were removed while their reversed files were generated.", timelineId);
    return { ...edit, ok: edit.ok && failed.length === 0, failed, generated: finished.length };
  },

  unreverse_clips: (params) => {
    for (const id of params.elementIds) requireElement(currentDoc(), id);
    return commit(doc => unreverseMany(doc, params.elementIds), "None of those clips is reversed.");
  },

  list_templates: async () => {
    await refreshTemplateLibrary();
    return { templates: installedTemplates() };
  },

  install_template: async (params) => {
    outsideBatch();
    const bytes = await api().filesystem.readFile(params.path);
    const result = await installTemplateArchive(params.path, bytes);
    if (!result.ok) throw new Error(result.message);
    return result;
  },

  add_template: async (params) => {
    editable();
    const timelineId = useTimelineStore.getState().activeTimelineId;
    if (!canHoldTemplates(timelineId)) throw new Error(NESTED_TEMPLATE_MESSAGE);
    const options = renderOptionStore.getState().options;
    const frame = { ...options.previewSize };
    const startMs = snapMsToFrame(params.startMs ?? useTimelineStore.getState().cursor, options.fps);
    await refreshTemplateLibrary();
    const listing = templateListing(params.templateId);
    if (listing == null) throw new Error("That template is not installed.");
    const data = await loadTemplate(params.templateId);
    if (data == null) throw new Error(`${listing.name} could not be read.`);
    const elementId = uuidv4();
    const trackId = uuidv4();
    const element = createTemplateElement({ templateId: params.templateId, name: data.name,
      durationMs: data.durationMs, size: data.size, frame });
    const edit = commit(doc => addTemplate(doc, elementId, element, startMs, trackId, params.trackId),
      `${listing.name} could not be placed there.`, timelineId);
    return { ...edit, elementId: edit.ok ? elementId : undefined };
  },

  expand_template: async (params) => {
    editable();
    return expandTemplate(params.elementId);
  },

  list_compositions: () => {
    const state = useTimelineStore.getState();
    return {
      activeTimelineId: state.activeTimelineId,
      openTimelineIds: [MAIN_TIMELINE, ...state.openCompositionIds],
      compositions: Object.values(state.compositions).map(meta => {
        const content = contentOfState(state, meta.id);
        return { ...meta, clips: Object.keys(content?.elements ?? {}).length, tracks: content?.tracks.length ?? 0 };
      }),
    };
  },

  switch_timeline: (params) => {
    editable();
    knownTimeline(params.timelineId);
    const ok = requestTimelineSwitch(params.timelineId);
    return { ok, activeTimelineId: useTimelineStore.getState().activeTimelineId };
  },

  close_timeline: (params) => {
    editable();
    knownTimeline(params.timelineId);
    if (params.timelineId === MAIN_TIMELINE) throw new Error("The main timeline cannot be closed.");
    requestCloseTimelineTab(params.timelineId);
    return { ok: !useTimelineStore.getState().openCompositionIds.includes(params.timelineId), activeTimelineId: useTimelineStore.getState().activeTimelineId };
  },

  export_template: async (params) => {
    outsideBatch();
    const state = useTimelineStore.getState();
    const timelineId = params.timelineId ?? state.activeTimelineId;
    knownTimeline(timelineId);
    const content = contentOfState(state, timelineId);
    if (content == null) throw new Error("That timeline is unavailable.");
    const options = projectRenderOptions();
    const meta = state.compositions[timelineId];
    const built = await buildTemplateArchive({
      ...content,
      renderOptions: serializeRenderOptions(meta == null ? options : { ...options, previewSize: meta.size }, { previewRatio: 1, videoDestination: "" }),
      name: params.name ?? meta?.name ?? templateNameFrom(params.path), author: params.author,
    });
    if (!built.ok) throw new Error(built.message);
    const written = await api().filesystem.writeFileEnsured(params.path, arrayBufferToBase64(await built.blob.arrayBuffer()));
    if (written?.status !== true) throw new Error(written?.error ?? "The template archive could not be written.");
    return { ok: true, path: params.path, warnings: built.warnings };
  },

  import_subtitles: async (params) => {
    editable();
    if (params.sourceElementId != null && !isDynamicElement(requireElement(currentDoc(), params.sourceElementId))) {
      throw new Error("The subtitle source must be a video or audio clip.");
    }
    return importSubtitlePaths(params.paths, params.sourceElementId == null
      ? { kind: "timeline" } : { kind: "clip", key: params.sourceElementId });
  },

  export_subtitles: async (params) => {
    outsideBatch();
    const doc = currentDoc();
    if (params.elementIds != null) for (const id of params.elementIds) requireElement(doc, id);
    const cues = cuesFromDocument(doc, params.elementIds == null ? { kind: "all" } : { kind: "elements", ids: params.elementIds });
    if (cues.length === 0) throw new Error("There are no nonempty text clips in the requested scope.");
    const flavour = flavourForPath(params.path);
    const result = await writeSubtitleFile(params.path, serializeSubtitles(cues, flavour));
    if (!result.ok) throw new Error(result.message);
    return { ok: true, path: params.path, cues: cues.length, flavour };
  },

  generate_proxies: async (params) => {
    outsideBatch();
    const result = await api().proxy.generate(params.sources, params.force === true);
    await refreshProxies();
    return result;
  },

  get_proxy_status: async () => {
    const request = api().proxy;
    const [entries, stats] = await Promise.all([request.list(), request.stats()]);
    const state = proxyStore.getState();
    return { mode: state.mode, entries, stats, progress: state.progress };
  },

  set_proxy_mode: (params) => {
    if (params.mode !== "off" && params.mode !== "prefer") throw new Error("Proxy mode must be off or prefer.");
    proxyStore.getState().setMode(params.mode);
    return { ok: true, mode: proxyStore.getState().mode };
  },

  get_template_detail: async (params) => {
    let templateId = params.templateId;
    let element: TemplateElementType | undefined;
    if (params.elementId != null) {
      const found = requireElement(currentDoc(), params.elementId);
      if (found.filetype !== "template") throw new Error("The requested clip is not a template.");
      element = found as TemplateElementType;
      templateId = element.templateId;
    }
    if (!templateId) throw new Error("Pass templateId or elementId.");
    await refreshTemplateLibrary();
    const data = await loadTemplate(templateId);
    if (data == null) throw new Error("That template could not be loaded.");
    return { templateId, name: data.name, size: data.size, durationMs: data.durationMs,
      slots: data.slots, fills: element?.fills ?? {}, clips: Object.keys(data.elements).length };
  },

  set_template_fill: async (params) => {
    editable();
    const timelineId = useTimelineStore.getState().activeTimelineId;
    const found = requireElement(currentDoc(), params.elementId);
    if (found.filetype !== "template") throw new Error("The requested clip is not a template.");
    const templateId = (found as TemplateElementType).templateId;
    const data = await loadTemplate(templateId);
    const slot = data?.slots.find(item => item.slotId === params.slotId);
    // Clearing a stored fill is possible even if the original template is missing.
    if (params.fill != null && slot == null) throw new Error("That template slot is unavailable. Use get_template_detail for slot ids.");
    let fill: TemplateFill | null = null;
    if (params.fill?.kind === "text") {
      if (slot?.kind !== "text") throw new Error("This slot takes media, not text.");
      fill = { kind: "text", text: params.fill.text };
    } else if (params.fill?.kind === "media") {
      if (slot?.kind !== "media") throw new Error("This slot takes text, not media.");
      const probe = await probeMedia(params.fill.path);
      if (probe.kind === "audio") throw new Error("Template media slots take video, image or GIF files.");
      fill = { kind: "media", localpath: probe.localpath, offsetMs: 0,
        sourceDurationMs: probe.durationMs, hasAudio: probe.hasAudio };
    } else if (params.fill != null) {
      throw new Error("A fill must have kind text or media, or be null to clear.");
    }
    return commit(doc => {
      const current = doc.elements[params.elementId];
      if (current?.filetype !== "template" || (current as TemplateElementType).templateId !== templateId) return doc;
      const next = setTemplateFill(doc, params.elementId, params.slotId, fill);
      return fill?.kind === "media" && params.fill.offsetMs != null
        ? setTemplateFillOffset(next, params.elementId, params.slotId, params.fill.offsetMs) : next;
    }, "The template fill is unchanged or the template clip changed while its media loaded.", timelineId);
  },

  mark_template_slots: (params) => {
    const elementIds = [...new Set<string>(params.elementIds)];
    for (const id of elementIds) requireElement(currentDoc(), id);
    const generated = elementIds.map(() => uuidv4());
    const edit = commit(doc => {
      let index = 0;
      return params.replaceable === false ? clearReplaceable(doc, elementIds)
        : setReplaceable(doc, elementIds, () => generated[index++], params.label);
    }, "No requested clip could change its replaceable slot mark.");
    return { ...edit, slots: slotsOf(currentDoc().elements) };
  },

  set_track_hidden: (params) => {
    requireTrack(currentDoc(), params.trackId);
    const edit = commit(doc => setTrackHidden(doc, params.trackId, params.hidden),
      "The track visibility is unchanged, or this track kind has no picture to hide.");
    return { ...edit, track: requireTrack(currentDoc(), params.trackId) };
  },

  list_extension_commands: async () => {
    outsideBatch();
    const host = hostStateStore.getState();
    const contributions = contributionStore.getState();
    const native = (window as any).electronAPI?.req?.ext;
    const installed = native?.list == null ? undefined : await native.list();
    return { connected: isExtensionHostConnected(), host: {
      state: host.state, crashes: host.crashes, lastError: host.lastError,
    }, extensions: contributions.extensions, commands: contributions.commands,
    views: contributions.views, menus: contributions.menus,
    keybindings: contributions.keybindings, statusItems: contributions.statusItems, installed };
  },

  run_extension_command: async (params) => {
    outsideBatch();
    // Unlike the GUI's toast-catching wrapper, this throws a missing-host,
    // missing-command, timeout or execution failure through the agent bridge.
    const result = await invokeContributedCommand(params.extensionId, params.commandId, params.args);
    return { ok: true, extensionId: params.extensionId, commandId: params.commandId, result: result ?? null };
  },
});
