import { createDatabase, getAppSettings } from "./db/database.js";
import { createApp } from "./app.js";
import { getDevMihomoPaths, getRuntimeConfig } from "./lib/runtime.js";

async function main() {
  const runtime = getRuntimeConfig();
  const context = createDatabase(runtime, process.cwd());
  const app = await createApp(context);
  const settings = await getAppSettings(context);

  const host = settings.bindHost;
  const port = settings.bindPort;

  await app.listen({
    host,
    port,
  });

  if (runtime.localDevMode) {
    console.log(`[local-dev] running with isolated data at ${context.paths.dataDir}`);
  }

  if (runtime.devMihomoMode) {
    const devMihomo = getDevMihomoPaths(process.cwd());
    console.log(
      `[local-dev] live Mihomo target enabled at ${devMihomo.controllerUrl} using ${devMihomo.configFile}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
