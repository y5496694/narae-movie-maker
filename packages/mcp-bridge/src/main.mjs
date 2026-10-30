/**
 * The process: stdio framing, configuration, and a clean exit.
 *
 * stdout carries the protocol and nothing else; a stray log line there is a
 * message the client cannot parse. Everything human-readable goes to stderr.
 */

import fs from "node:fs";
import os from "node:os";
import { createRelay } from "./relay.mjs";
import { Upstream, UpstreamError } from "./upstream.mjs";
import {
  noTokenMessage,
  resolveToken,
  resolveUrl,
} from "./config.mjs";

const USAGE = `narae-desktop-mcp: 나래 무비메이커 데스크톱 앱에 연결하는 로컬 MCP 브리지

MCP 클라이언트에서 로컬 파일을 Node.js로 실행하세요.

  claude mcp add narae-desktop -- node "C:/path/to/packages/mcp-bridge/bin/narae-desktop-mcp.mjs"

실행 중인 나래 무비메이커 데스크톱 앱에 연결합니다.
토큰은 narae-movie-maker/config.json의 mcp_token에서 읽습니다.
NARAE_MCP_TOKEN과 NARAE_MCP_URL로 설정을 덮어쓸 수 있습니다.
기본 주소: http://127.0.0.1:9827/mcp
기존 로컬 설정의 CARTCUT_MCP_TOKEN/URL도 대체 값으로 인식합니다.

이 패키지는 로컬 전용이며 npm 또는 MCP Registry에 게시하지 않습니다.
GUI 없이 실행하는 독립 MCP 엔진은 소스 루트 cli/의 나래 CLI를 사용하세요.
`;

/** Newline-delimited JSON, the stdio transport's framing. */
function createLineReader(onMessage, onInvalid) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim() === "") {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        onInvalid(line);
        continue;
      }
      onMessage(message);
    }
  };
}

export function run({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  version = "unknown",
  exit = (code) => process.exit(code),
} = {}) {
  if (argv.includes("--version") || argv.includes("-v")) {
    stdout.write(`${version}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    stdout.write(USAGE);
    return;
  }
  if (stdin.isTTY) {
    stderr.write(USAGE);
  }

  const log = (text) => stderr.write(`[narae-desktop-mcp] ${text}\n`);
  const url = resolveUrl(env);

  const connect = (onmessage) => {
    const found = resolveToken({
      env,
      platform,
      home,
      readFile: (file) => fs.readFileSync(file, "utf8"),
    });
    if (found.token == null) {
      throw new UpstreamError("unauthorized", noTokenMessage(found));
    }
    return new Upstream({
      url,
      token: found.token,
      tokenSource: found.source,
      onmessage,
      log,
    });
  };

  const toClient = (message) => {
    stdout.write(`${JSON.stringify(message)}\n`);
  };

  const relay = createRelay({ connect, toClient, log });

  const read = createLineReader(
    (message) => {
      relay.handle(message).catch((error) => {
        log(`unexpected: ${error?.stack ?? error}`);
      });
    },
    (line) => log(`ignored a line that is not JSON: ${line.slice(0, 200)}`),
  );

  let ending = false;
  const end = () => {
    if (ending) {
      return;
    }
    ending = true;
    relay.close().finally(() => exit(0));
  };

  stdin.setEncoding("utf8");
  stdin.on("data", read);
  // The client closing our stdin is how a stdio server is told to stop.
  stdin.on("end", end);
  stdin.on("close", end);
  // EPIPE: the client went away without closing stdin first.
  stdout.on("error", end);
  process.once("SIGINT", end);
  process.once("SIGTERM", end);
}
