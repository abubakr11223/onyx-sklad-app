// Dev server for the video stand: `npm run video:serve`
// = `next dev -p 3100` against onyx_video, local photo store, Telegram/AI off.
import { spawn } from "node:child_process";
import { REPO_ROOT, VIDEO_PORT, videoAppEnv } from "./video-env";

const child = spawn("npx", ["next", "dev", "-p", String(VIDEO_PORT)], {
  cwd: REPO_ROOT,
  env: { ...process.env, ...videoAppEnv() },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => child.kill(sig));
}
