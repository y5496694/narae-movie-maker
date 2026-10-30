import { commandNames, registerCommands } from "../registry";

const ROOTS = new Set(["font", "preset", "template", "cloud", "storage", "filesystem", "ffmpeg", "ai", "ext", "media", "proxy", "reverse", "transcribe", "tts", "overlayRecord"]);
const GUI_ONLY = new Set(["storage.openFolder", "ext.openFolder", "ext.loadUnpacked", "overlayRecord.show", "overlayRecord.close", "overlayRecord.requestPermission", "ai.runMcpServer", "ai.getKey", "ffmpeg.installFFmpeg"]);
const DANGEROUS = /(?:^|\.)(?:delete|remove|uninstall|empty|clear)[a-zA-Z]*/;
function inventory() {
  const methods: Array<{ method: string; arguments: number; destructive: boolean }> = [];
  function visit(value: any, prefix: string) {
    for (const key of Object.keys(value ?? {})) {
      const name = `${prefix}.${key}`;
      if (GUI_ONLY.has(name) || /^on[A-Z]/.test(key)) continue;
      if (typeof value[key] === "function") methods.push({ method: name, arguments: value[key].length, destructive: DANGEROUS.test(name) });
      else if (value[key] && typeof value[key] === "object") visit(value[key], name);
    }
  }
  const api = window.electronAPI?.req;
  for (const root of ROOTS) visit(api?.[root], root);
  return methods;
}
registerCommands({
  narae_capabilities: () => ({ commands: commandNames(), native: inventory(), batchCompatible: true }),
  invoke_native: async (params) => {
    const item = inventory().find(item => item.method === params.method);
    if (!item) throw new Error("Unknown native method. Read narae_capabilities first.");
    if (item.destructive && params.allowDestructive !== true) throw new Error("This native method requires allowDestructive=true.");
    let target: any = window.electronAPI.req;
    const segments = params.method.split(".");
    for (const segment of segments) {
      if (["__proto__", "prototype", "constructor"].includes(segment)) throw new Error("Invalid method path");
      target = target[segment];
    }
    return target(...(params.args ?? []));
  },
});
