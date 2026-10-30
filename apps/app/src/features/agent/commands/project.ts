import project from "../../../functions/project";
import { renderOptionStore } from "../../../states/renderOptionStore";
import { exportStore } from "../../../states/exportStore";
import { useTimelineStore } from "../../../states/timelineStore";
import { setProjectFps } from "../../editor/frameRate";
import { canStartExport, getExportOutcome, startExport } from "../../export/exportSession";
import { registerCommands } from "../registry";

let job: { path: string; error?: string } | null = null;

registerCommands({
  open_project: async (params) => {
    if (!canStartExport()) throw new Error("Wait until the running export finishes.");
    await project.openProjectFile(params.path);
    return { ok: true, path: params.path };
  },

  configure_project: (params) => {
    if (!canStartExport()) throw new Error("Wait until the running export finishes.");
    if (useTimelineStore.getState().activeTimelineId !== "main") {
      throw new Error("Switch to the main timeline before configuring the project.");
    }
    if (params.fps != null) setProjectFps(params.fps);
    const store = renderOptionStore.getState();
    store.updateOptions({
      ...store.options,
      previewSize: {
        w: params.width ?? store.options.previewSize.w,
        h: params.height ?? store.options.previewSize.h,
      },
      duration: params.durationMs == null ? store.options.duration : params.durationMs / 1000,
      backgroundColor: params.backgroundColor ?? store.options.backgroundColor,
    });
    if (params.exportSettings) renderOptionStore.getState().updateExportSettings(params.exportSettings);
    return { ok: true, options: renderOptionStore.getState().options };
  },

  save_project: async (params) => {
    const result = await project.saveProjectFile({ projectDestination: params.path });
    if (!result.ok) throw new Error(result.message);
    return result;
  },

  export_video: (params) => {
    if (!canStartExport() || (job && !job.error && getExportOutcome() == null)) {
      throw new Error("An export is already running.");
    }
    const defaults: Record<string, any> = {
      mp4: { videoCodec: "h264", audioCodec: "aac" },
      mov: { videoCodec: "prores", audioCodec: "pcm_s16le" },
      webm: { videoCodec: "vp9", audioCodec: "opus" },
      gif: { videoCodec: "gif" },
    };
    const current = renderOptionStore.getState().options.exportSettings;
    const container = params.container ?? current.container;
    renderOptionStore.getState().updateExportSettings({
      ...(container === current.container ? {} : defaults[container]), container,
      ...params.settings,
    });
    job = { path: params.path };
    void startExport(params.path, params.overwrite === true).catch(error => {
      if (job != null && job.path === params.path) job.error = String(error?.message ?? error);
    });
    return { started: true, path: params.path };
  },

  get_export_status: () => {
    const state = exportStore.getState();
    const outcome = getExportOutcome();
    return {
      phase: state.phase,
      percent: state.percent,
      remainingMs: state.remainingMs,
      destination: job?.path ?? state.destination,
      status: job?.error ? "failed" : outcome?.ok === true ? "complete" : outcome?.ok === false ? "failed" : job ? "running" : "idle",
      error: job?.error ?? (outcome?.ok === false ? outcome.error : undefined),
    };
  },
});
