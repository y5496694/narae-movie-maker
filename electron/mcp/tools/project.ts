import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { requestEditor } from "../bridge";
import { mutating, readOnly, tool, type Registrar } from "./define";

async function destination(input: string, extension: string | string[], overwrite = false) {
  const allowed = Array.isArray(extension) ? extension : [extension];
  if (!path.isAbsolute(input) || !allowed.includes(path.extname(input).toLowerCase())) {
    throw new Error(`An absolute ${allowed.join(" or ")} file path is required.`);
  }
  const resolved = path.resolve(input);
  if (!overwrite) {
    try {
      await fs.access(resolved);
      throw new Error("The destination already exists. Choose a new filename or set overwrite=true.");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

export function registerProjectTools(define: Registrar) {
  define("open_project", {
    title: "Open a saved project without dialogs",
    description: "Open an absolute .ngt project path. Refuses if the current project has unsaved changes. Uses the same loader as the editor's File Open command.",
    inputSchema: { path: z.string().min(1) }, annotations: mutating,
  }, tool(async args => {
    if (!path.isAbsolute(args.path) || ![".ngt", ".nmm"].includes(path.extname(args.path).toLowerCase())) throw new Error("An absolute .nmm or .ngt path is required.");
    await fs.access(args.path);
    return requestEditor("open_project", { path: path.resolve(args.path) }, 120000);
  }));

  define("configure_project", {
    title: "Configure the project",
    description: "Set the main project's pixel size, frame rate, duration in milliseconds and background without opening settings. Refuses during an export.",
    inputSchema: {
      width: z.number().int().min(16).max(7680).multipleOf(2).optional(),
      height: z.number().int().min(16).max(7680).multipleOf(2).optional(),
      fps: z.number().int().min(1).max(120).optional(),
      durationMs: z.number().positive().max(10800000).optional(),
      backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      exportSettings: z.record(z.any()).optional(),
    },
    annotations: mutating,
  }, tool(args => requestEditor("configure_project", args)));

  define("save_project", {
    title: "Save the project to a file",
    description: "Write the open project to an absolute .ngt path and await the actual write. Does not open a save dialog. Existing files require overwrite=true.",
    inputSchema: { path: z.string().min(1), overwrite: z.boolean().optional().default(false) },
    annotations: mutating,
  }, tool(async args => requestEditor("save_project", { path: await destination(args.path, [".nmm", ".ngt"], args.overwrite) }, 120000)));

  define("export_video", {
    title: "Export the project without dialogs",
    description: "Start a native renderer export to an absolute MP4, MOV, WebM or GIF path. Poll get_export_status until complete or failed. Existing files require overwrite=true. Encoder settings use the same normalizer as the GUI.",
    inputSchema: { path: z.string().min(1), overwrite: z.boolean().optional().default(false), settings: z.record(z.any()).optional() },
    annotations: mutating,
  }, tool(async args => requestEditor("export_video", { path: await destination(args.path, [".mp4", ".mov", ".webm", ".gif"], args.overwrite), container: path.extname(args.path).slice(1).toLowerCase(), settings: args.settings, overwrite: args.overwrite })));

  define("get_export_status", {
    title: "Read export progress and outcome",
    description: "Return the asynchronous export's phase, percentage, destination and explicit success or failure. A running job can be polled without blocking a long tool call.",
    inputSchema: {}, annotations: readOnly,
  }, tool(() => requestEditor("get_export_status", {})));
}
