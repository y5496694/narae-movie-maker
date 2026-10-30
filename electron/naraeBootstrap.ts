import { app } from "electron";
import fs from "fs";
import path from "path";

// The CLI selects a private profile before any electron-store is constructed.
if (process.env.NARAE_JOB_FILE) {
  const job = JSON.parse(fs.readFileSync(process.env.NARAE_JOB_FILE, "utf8"));
  process.env.NARAE_HEADLESS = "1";
  if (!path.isAbsolute(job.profilePath) || !path.isAbsolute(job.resultPath)) {
    throw new Error("The headless engine requires absolute private profile and result paths.");
  }
  app.setPath("userData", job.profilePath);
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
}
if (/^narae-engine(?:\.exe)?$/i.test(path.basename(process.execPath)) && !process.env.NARAE_JOB_FILE) {
  console.error("나래 CLI 렌더 엔진입니다. narae.cmd를 통해 작업을 실행하세요.");
  void app.whenReady().then(() => app.exit(2));
} else {
  require("./main");
}
