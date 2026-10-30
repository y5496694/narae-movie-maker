import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { registerToolsWith } from "../mcp/tools";
import { registerExtensionTools } from "../extension/mcpTools";
import type { Registrar, ToolConfig } from "../mcp/tools/define";

type Entry = { config: ToolConfig; handler: (args: any) => Promise<any> };
const schemaFor = zodToJsonSchema as (schema: any) => any;
export function engineTools() {
  const entries = new Map<string, Entry>();
  const define: Registrar = (name, config, handler) => entries.set(name, { config, handler });
  registerToolsWith(define);
  registerExtensionTools(define);
  return {
    describe: () => Array.from(entries, ([name, entry]) => ({
      name, title: entry.config.title, description: entry.config.description,
      inputSchema: schemaFor(z.object(entry.config.inputSchema ?? {})),
      annotations: entry.config.annotations,
    })),
    call: async (name: string, args: unknown = {}) => {
      const entry = entries.get(name);
      if (!entry) throw new Error(`Unknown engine tool: ${name}`);
      const parsed = z.object(entry.config.inputSchema ?? {}).strict().parse(args);
      const response = await entry.handler(parsed);
      const text = response.content?.filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n") ?? "";
      if (response.isError) throw new Error(text || `${name} failed`);
      let result: any;
      try { result = JSON.parse(text); } catch { result = response; }
      if (result?.ok === false) throw new Error(result.reason ?? result.error ?? `${name} was declined`);
      return result;
    },
  };
}
