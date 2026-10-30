import { z } from "zod";
import { requestEditor } from "../bridge";
import { readOnly, mutating, tool, type Registrar } from "./define";

export function registerNaraeNativeTools(define: Registrar) {
  define("narae_capabilities", { title: "List engine and native capabilities", description: "Inventory every registered renderer command and the native non-dialog methods available to the GUI and independent CLI.", inputSchema: {}, annotations: readOnly }, tool(() => requestEditor("narae_capabilities")));
  define("invoke_native", {
    title: "Run a native media capability",
    description: "Call an inventoried non-dialog native method by its exact dotted name and positional JSON arguments. Includes cloud, fonts, presets, extensions, transcription, TTS and media processing. Event subscriptions and GUI window controls are not methods for batch jobs. Explicit allowDestructive is required for removal methods.",
    inputSchema: { method: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/), args: z.array(z.any()).optional().default([]), allowDestructive: z.boolean().optional().default(false) }, annotations: mutating,
  }, tool(args => requestEditor("invoke_native", args, 1800000)));
}
