import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { requestEditor } from "../bridge";
import { mutating, readOnly, tool, type Registrar } from "./define";

const LONG_MEDIA_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const ids = z.array(z.string().min(1)).min(1);

async function readable(input: string, extensions?: string[]): Promise<string> {
  if (!path.isAbsolute(input) || (extensions != null && !extensions.includes(path.extname(input).toLowerCase()))) {
    throw new Error(`An absolute ${extensions?.join(" or ") ?? "media"} file path is required.`);
  }
  const resolved = path.resolve(input);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("The source must be a regular file.");
  return resolved;
}

async function destination(input: string, extensions: string[], overwrite = false): Promise<string> {
  if (!path.isAbsolute(input) || !extensions.includes(path.extname(input).toLowerCase())) {
    throw new Error(`An absolute ${extensions.join(" or ")} file path is required.`);
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

export function registerNaraeParityTools(define: Registrar) {
  define("set_speed_curve", {
    title: "Set a variable playback speed ramp",
    description: "Set video/audio speed points using absolute source milliseconds t and speed multiplier v (0.25-4). Uses the editor's speed integrator and frame snapping. points=null removes the ramp while preserving its mean playback rate. ripple shifts subsequent clips when needed.",
    inputSchema: { elementId: z.string(), points: z.array(z.object({ t: z.number().nonnegative(), v: z.number().min(0.25).max(4) })).min(1).nullable(), ripple: z.boolean().optional().default(false) },
    annotations: mutating,
  }, tool(args => requestEditor("set_speed_curve", args)));

  define("reverse_clips", {
    title: "Reverse video clips and their audio",
    description: "Generate reversed files for each forward video clip's trim window and await completion before applying them as one undoable edit. Uses FFmpeg and preserves timeline span and visual properties. Reports partial failures explicitly. Run outside batch_edit.",
    inputSchema: { elementIds: ids }, annotations: mutating,
  }, tool(args => requestEditor("reverse_clips", args, LONG_MEDIA_TIMEOUT_MS)));

  define("unreverse_clips", {
    title: "Restore reversed clips to their forward sources",
    description: "Restore forward source paths and mapped trims without re-encoding, as one undoable edit.",
    inputSchema: { elementIds: ids }, annotations: mutating,
  }, tool(args => requestEditor("unreverse_clips", args)));

  define("list_templates", {
    title: "List installed templates",
    description: "Refresh and list builtin, user, extension and downloaded cloud template manifests and paths.",
    inputSchema: {}, annotations: readOnly,
  }, tool(args => requestEditor("list_templates", args)));

  define("install_template", {
    title: "Install a template archive",
    description: "Validate and install an absolute .cttpl archive using the editor's installer. Reinstalling the same archive name replaces that user template. Run outside batch_edit.",
    inputSchema: { path: z.string().min(1) }, annotations: mutating,
  }, tool(async args => requestEditor("install_template", { path: await readable(args.path, [".cttpl"]) }, 120000)));

  define("add_template", {
    title: "Place an installed template on the main timeline",
    description: "Add an installed template at a frame-snapped start, fitted to the project frame. startMs defaults to the playhead. Nested templates in a composition remain unsupported by the original editor. Run outside batch_edit.",
    inputSchema: { templateId: z.string().min(1), startMs: z.number().nonnegative().optional(), trackId: z.string().optional() }, annotations: mutating,
  }, tool(args => requestEditor("add_template", args, 120000)));

  define("expand_template", {
    title: "Expand a template into an editable composition",
    description: "Fork an installed template into project-owned editable clips, or reopen its existing composition. Opens its timeline and records the initial fork as one undoable edit. Run outside batch_edit.",
    inputSchema: { elementId: z.string() }, annotations: mutating,
  }, tool(args => requestEditor("expand_template", args, 120000)));

  define("list_compositions", {
    title: "List project compositions and timeline tabs",
    description: "Read each editable composition's id, name, pixel size, source and clip/track counts, plus the active timeline and open tabs.",
    inputSchema: {}, annotations: readOnly,
  }, tool(args => requestEditor("list_compositions", args)));

  define("switch_timeline", {
    title: "Switch the active editing timeline",
    description: "Switch to main or a composition id from list_compositions. Subsequent clip, track and subtitle tools operate there. Run outside batch_edit.",
    inputSchema: { timelineId: z.string().min(1) }, annotations: mutating,
  }, tool(args => requestEditor("switch_timeline", args)));

  define("close_timeline", {
    title: "Close a composition's editing tab",
    description: "Close a composition tab while retaining it in the project. The main timeline cannot be closed. Run outside batch_edit.",
    inputSchema: { timelineId: z.string().min(1) }, annotations: mutating,
  }, tool(args => requestEditor("close_timeline", args)));

  define("export_template", {
    title: "Save a timeline as a portable template archive",
    description: "Package the active or named timeline and media into an absolute .cttpl path without dialogs. Uses the editor's template archive and relative asset serializer. Nested template restrictions are preserved and reported. Existing files require overwrite=true. Run outside batch_edit.",
    inputSchema: { path: z.string().min(1), timelineId: z.string().optional(), name: z.string().min(1).optional(), author: z.string().optional(), overwrite: z.boolean().optional().default(false) }, annotations: mutating,
  }, tool(async args => requestEditor("export_template", { ...args, path: await destination(args.path, [".cttpl"], args.overwrite) }, 120000)));

  define("import_subtitles", {
    title: "Import SubRip or WebVTT subtitle files",
    description: "Read .srt/.vtt files directly, decode UTF-8 or Korean CP949, and place text clips as one undoable edit. By default file times are timeline times; sourceElementId maps source timestamps through that video/audio clip's trim and speed. Run outside batch_edit.",
    inputSchema: { paths: z.array(z.string().min(1)).min(1), sourceElementId: z.string().optional() }, annotations: mutating,
  }, tool(async args => requestEditor("import_subtitles", { ...args, paths: await Promise.all(args.paths.map((p: string) => readable(p, [".srt", ".vtt"]))) }, 120000)));

  define("export_subtitles", {
    title: "Export text clips to SubRip or WebVTT",
    description: "Write all text clips in the active timeline, or explicit elementIds, to an absolute .srt/.vtt path and await the write. Does not depend on current GUI selection. Existing files require overwrite=true. Run outside batch_edit.",
    inputSchema: { path: z.string().min(1), elementIds: ids.optional(), overwrite: z.boolean().optional().default(false) }, annotations: mutating,
  }, tool(async args => requestEditor("export_subtitles", { ...args, path: await destination(args.path, [".srt", ".vtt"], args.overwrite) }, 120000)));

  define("generate_proxies", {
    title: "Generate optimized preview proxies",
    description: "Await the editor's serial FFmpeg proxy pass for absolute source media paths. Returns made/skipped/failed sources and refreshes preview state. Small sources are skipped unless force=true. Export continues to use originals. Run outside batch_edit.",
    inputSchema: { sources: z.array(z.string().min(1)).min(1), force: z.boolean().optional().default(false) }, annotations: mutating,
  }, tool(async args => requestEditor("generate_proxies", { ...args, sources: await Promise.all(args.sources.map((p: string) => readable(p))) }, LONG_MEDIA_TIMEOUT_MS)));

  define("get_proxy_status", {
    title: "Read preview proxy cache and generation progress",
    description: "Read the native proxy index, cache directory/size, active preview mode and current pass progress.",
    inputSchema: {}, annotations: readOnly,
  }, tool(args => requestEditor("get_proxy_status", args)));

  define("set_proxy_mode", {
    title: "Choose optimized preview media",
    description: "prefer uses existing proxies and falls back to originals; off always previews originals. This is preview state and does not change project media or exported output.",
    inputSchema: { mode: z.enum(["off", "prefer"]) }, annotations: mutating,
  }, tool(args => requestEditor("set_proxy_mode", args)));

  define("get_template_detail", {
    title: "Read a template's replaceable slots",
    description: "Load an installed templateId or a placed template elementId and return its size, duration, replaceable text/media slots and current fills. Use slot ids with set_template_fill.",
    inputSchema: { templateId: z.string().optional(), elementId: z.string().optional() }, annotations: readOnly,
  }, tool(args => requestEditor("get_template_detail", args, 120000)));

  define("set_template_fill", {
    title: "Fill or clear one template slot",
    description: "Fill a template's text slot with text, or its media slot with an absolute video/image/GIF path. Media is probed for duration/audio; offsetMs selects a source in-point. fill=null clears the override. The edit is undoable. Run outside batch_edit.",
    inputSchema: { elementId: z.string(), slotId: z.string().min(1), fill: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("media"), path: z.string().min(1), offsetMs: z.number().nonnegative().optional() }),
    ]).nullable() }, annotations: mutating,
  }, tool(async args => {
    const fill = args.fill?.kind === "media" ? { ...args.fill, path: await readable(args.fill.path) } : args.fill;
    return requestEditor("set_template_fill", { ...args, fill }, 120000);
  }));

  define("mark_template_slots", {
    title: "Author replaceable template slots",
    description: "Mark video/image/GIF/text clips as replaceable slots before export_template. Each new mark gets a stable unique slot id; existing marks retain theirs. replaceable=false removes marks. Returns the active timeline's derived slots.",
    inputSchema: { elementIds: ids, replaceable: z.boolean().optional().default(true), label: z.string().optional() }, annotations: mutating,
  }, tool(args => requestEditor("mark_template_slots", args)));

  define("set_track_hidden", {
    title: "Hide or show a picture track",
    description: "Change the editor's track eye state as one undoable edit. Hidden tracks do not contribute picture to preview or export. Track kinds without pictures preserve the original editor's refusal rules.",
    inputSchema: { trackId: z.string(), hidden: z.boolean() }, annotations: mutating,
  }, tool(args => requestEditor("set_track_hidden", args)));

  define("list_extension_commands", {
    title: "List extension host state and contributed commands",
    description: "Read the live extension host connection, crash/error state, loaded extensions, contributed commands/views/menus/keybindings/status items, and installed native extension listings. Run outside batch_edit.",
    inputSchema: {}, annotations: readOnly,
  }, tool(args => requestEditor("list_extension_commands", args)));

  define("run_extension_command", {
    title: "Invoke an installed extension's contributed command",
    description: "Await a command from list_extension_commands through the same extension host dispatcher used by the GUI. Missing hosts/commands, timeouts and execution errors are reported as failures. Extension permissions remain enforced by the host. Run outside batch_edit.",
    inputSchema: { extensionId: z.string().min(1), commandId: z.string().min(1), args: z.unknown().optional() }, annotations: mutating,
  }, tool(args => requestEditor("run_extension_command", args, LONG_MEDIA_TIMEOUT_MS)));
}
