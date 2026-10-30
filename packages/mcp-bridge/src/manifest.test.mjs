/**
 * What the bridge copies from the app by hand, and what a release has to keep
 * in agreement. Each of these fails at the user's first connection and nowhere
 * earlier, so they are pinned here.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_DIR, DEFAULT_URL } from "./config.mjs";

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const pkg = JSON.parse(read("../package.json"));
const server = JSON.parse(read("../server.json"));
const app = JSON.parse(read("../../../package.json"));
const appServer = read("../../../electron/mcp/server.ts");

describe("the copies of the app's facts", () => {
  it("looks for the token in the folder Electron names after the app", () => {
    // A top-level `productName` would take over `app.name` and move userData;
    // `build.productName` is electron-builder's and does not.
    expect(app.productName).toBeUndefined();
    expect(app.name).toBe(APP_DIR);
  });

  it("reads the key the app stores the token under", () => {
    expect(appServer).toContain('store.get("mcp_token")');
  });

  it("dials the address the app listens on", () => {
    const port = appServer.match(/MCP_PORT = (\d+)/)?.[1];
    const host = appServer.match(/MCP_HOST = "([^"]+)"/)?.[1];
    const path = appServer.match(/MCP_PATH = "([^"]+)"/)?.[1];
    expect(DEFAULT_URL).toBe(`http://${host}:${port}${path}`);
  });
});

describe("the local private manifests", () => {
  it("agree on the local version and executable", () => {
    expect(server.version).toBe(pkg.version);
    expect(pkg.version).toBe(app.version);
    expect(server.name).toBe(pkg.name);
    expect(server.launch.command).toBe("node");
    expect(server.launch.args).toEqual([pkg.bin["narae-desktop-mcp"]]);
    expect(read(`../${server.launch.args[0]}`)).toContain('import { run }');
    expect(server.endpoint).toBe(DEFAULT_URL);
  });

  it("disable publication and declare no public registry identity", () => {
    expect(pkg.private).toBe(true);
    expect(server.private).toBe(true);
    expect(pkg.publishConfig).toBeUndefined();
    expect(pkg.mcpName).toBeUndefined();
    expect(server.packages).toBeUndefined();
    expect(pkg.name).toBe("narae-desktop-mcp-bridge");
    expect(server.environmentVariables.map(item => item.name)).toEqual([
      "NARAE_MCP_TOKEN", "NARAE_MCP_URL",
    ]);
  });

  it("retains attribution and has no runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(server.upstream).toEqual(pkg.upstream);
    expect(pkg.upstream.repository).toBe("https://github.com/cartesiancs/cartcut");
    expect(read("../LICENSE")).toContain("Copyright (c) 2025 cartesiancs");
    expect(read("../NOTICE.txt")).toContain("CartCut v0.6.1");
  });
});
