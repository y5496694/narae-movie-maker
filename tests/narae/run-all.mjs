import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const out = path.resolve(process.argv[2] ?? path.join(repo, "../narae-analysis/runtime-fixtures"));
const names = process.argv.slice(3);
if (names.length === 0) names.push("inventory", "visual", "editing", "graphics", "parity", "reopen");
fs.mkdirSync(out, { recursive: true });
const results = [];
for (const name of names) {
  const job = path.join(out, `${name}.job.json`);
  const report = path.join(out, `${name}.result.json`);
  const run = spawnSync(process.execPath, [path.join(repo, "cli/narae.mjs"), "run", job, "--result", report], {
    cwd: repo, encoding: "utf8", windowsHide: true, timeout: 240000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NARAE_CONFIG_HOME: path.join(out, "private-cli-config"), NARAE_KEEP_RUNS: "1" },
  });
  fs.writeFileSync(path.join(out, `${name}.cli.log`), (run.stdout ?? "") + "\n" + (run.stderr ?? ""));
  let result;
  if (fs.existsSync(report)) result = JSON.parse(fs.readFileSync(report, "utf8"));
  let verification;
  if (run.status === 0 && result?.ok === true) {
    verification = spawnSync(process.execPath, [path.join(here, "verify-results.mjs"), out, name], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 30000 });
    fs.writeFileSync(path.join(out, `${name}.verification.log`), (verification.stdout ?? "") + "\n" + (verification.stderr ?? ""));
  }
  const summary = {
    name, exit: run.status, ok: run.status === 0 && result?.ok === true && verification?.status === 0,
    steps: result?.steps?.length ?? 0, engineError: result?.error ?? run.error?.message,
    verificationExit: verification?.status,
    ...(verification?.status && { verificationError: verification.stderr?.slice(-3000) }),
  };
  results.push(summary);
  console.log(JSON.stringify(summary));
}
const summary = { ok: results.every((r) => r.ok), generatedAt: new Date().toISOString(), results };
fs.writeFileSync(path.join(out, "runtime-summary.json"), JSON.stringify(summary, null, 2) + "\n");
process.exitCode = summary.ok ? 0 : 1;
