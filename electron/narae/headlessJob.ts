import { app, type WebContents } from "electron";
import fs from "fs/promises";
import path from "path";
import { engineTools } from "./toolRegistry";

function resolveRefs(value: any, context: Record<string, any>): any {
  if (Array.isArray(value)) return value.map(item => resolveRefs(item, context));
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && typeof value.$ref === "string") {
      let found: any = context;
      for (const key of value.$ref.split(".")) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Invalid reference segment");
        found = found?.[key];
      }
      if (found === undefined) throw new Error(`Unresolved step reference: ${value.$ref}`);
      return found;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, context)]));
  }
  return value;
}

export async function runHeadlessJob(contents: WebContents): Promise<number> {
  const file = process.env.NARAE_JOB_FILE!;
  const job = JSON.parse(await fs.readFile(file, "utf8"));
  const report: any = { ok: false, engine: { name: "나래 무비메이커 엔진", version: app.getVersion(), headless: true, guiInstalledRequired: false, mcpHttpRequired: false }, steps: [] };
  const context: Record<string, any> = Object.create(null);
  const tools = engineTools();
  const awaitExport = async (destination: string, timeoutMs = 3600000) => {
    const deadline = Date.now() + timeoutMs;
    let lastPercent = -1;
    while (Date.now() < deadline) {
      const state = await tools.call("get_export_status");
      if (Math.floor(state.percent / 5) !== lastPercent) {
        lastPercent = Math.floor(state.percent / 5);
        console.error(JSON.stringify({ event: "narae-export", ...state }));
      }
      if (state.status === "failed") throw new Error(state.error || "Export failed");
      if (state.status === "complete") {
        const stat = await fs.stat(destination);
        if (stat.size === 0) throw new Error("The export produced an empty file");
        return { ...state, bytes: stat.size };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Export timed out");
  };
  const write = async () => {
    await fs.mkdir(path.dirname(job.resultPath), { recursive: true });
    await fs.writeFile(job.resultPath + ".part", JSON.stringify(report, null, 2), "utf8");
    await fs.rename(job.resultPath + ".part", job.resultPath);
  };
  try {
    if (contents.isLoadingMainFrame()) await new Promise<void>((resolve, reject) => {
      contents.once("did-finish-load", () => resolve());
      contents.once("did-fail-load", (_event, code, reason) => reject(new Error(`Engine page failed: ${code} ${reason}`)));
    });
    if (job.listTools) {
      report.tools = tools.describe();
    } else {
      if (job.project) report.openedProject = await tools.call("open_project", { path: job.project });
      if (job.configure) report.configuration = await tools.call("configure_project", job.configure);
      for (let i = 0; i < (job.steps ?? []).length; i++) {
        const step = job.steps[i];
        const id = step.id ?? `step${i + 1}`;
        if (context[id] !== undefined || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error(`Duplicate or invalid step id: ${id}`);
        const args = resolveRefs(step.args ?? {}, context);
        let result = await tools.call(step.tool, args);
        if (step.tool === "export_video") result = await awaitExport(args.path, step.timeoutMs);
        context[id] = result;
        report.steps.push({ id, tool: step.tool, result });
        if (Array.isArray(result?.skipped) && result.skipped.length > 0 && step.allowSkipped !== true) throw new Error(`${step.tool} skipped media: ${JSON.stringify(result.skipped)}`);
      }
      if (job.saveProject) {
        const sameProject = job.project && path.resolve(job.project) === path.resolve(job.saveProject);
        report.savedProject = await tools.call("save_project", { path: job.saveProject, overwrite: job.overwrite === true || sameProject === true });
      }
      if (job.export) {
        await tools.call("export_video", { path: job.export.path, overwrite: job.export.overwrite === true, settings: job.export.settings });
        report.export = await awaitExport(job.export.path, job.export.timeoutMs);
      }
      report.project = await tools.call("get_project_overview");
    }
    report.ok = true;
    await write();
    return 0;
  } catch (error: any) {
    report.error = error?.message ?? String(error);
    await write();
    return 1;
  }
}
