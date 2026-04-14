import { existsSync } from "node:fs";
import { emitGatewayRestart } from "../infra/restart.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/bundle-watch");

const CHECK_INTERVAL_MS = 30_000;

/**
 * Watch the running bundle file for removal.
 *
 * When `pnpm build` completes it writes a new content-hashed bundle
 * (e.g. `server-DhOnZ22B.js`) and removes the previous one
 * (e.g. `server-O7S4IFon.js`).  If the gateway process is not restarted
 * afterwards it keeps serving stale code indefinitely.
 *
 * This watcher polls the path that Node.js loaded as its entry point.
 * When the file disappears it means a rebuild has replaced it, so we
 * trigger a SIGUSR1 gateway restart exactly as `openclaw gateway restart`
 * would do.
 */
export function startGatewayBundleWatch(): void {
  if (process.env.VITEST === "1" || process.env.NODE_ENV === "test") {
    return;
  }

  const bundlePath = process.argv[1];
  if (!bundlePath) {
    return;
  }

  const timer = setInterval(() => {
    if (!existsSync(bundlePath)) {
      log.info(`bundle replaced by new build, triggering gateway restart (bundle=${bundlePath})`);
      clearInterval(timer);
      emitGatewayRestart();
    }
  }, CHECK_INTERVAL_MS);

  // Do not keep the event loop alive for polling alone.
  timer.unref?.();
}
