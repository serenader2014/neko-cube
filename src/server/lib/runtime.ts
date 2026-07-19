import path from "node:path";

export const DEV_MIHOMO_RELATIVE_ROOT = path.join(".dev", "mihomo");
export const DEV_MIHOMO_CONTROLLER_PORT = 9096;

export type RuntimeConfig = {
  localDevMode: boolean;
  devMihomoMode: boolean;
  devMihomoSecret: string;
  schedulerEnabled: boolean;
  safeApplyMode: boolean;
  dataNamespace: string;
};

export type DevMihomoPaths = {
  rootDir: string;
  homeDir: string;
  configFile: string;
  controllerUrl: string;
  externalController: string;
};

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const devMihomoMode = parseBoolean(env.DEV_MIHOMO_MODE) || parseBoolean(env.LOCAL_DEV_MIHOMO);
  const localDevMode = parseBoolean(env.LOCAL_DEV_MODE) || devMihomoMode;

  return {
    localDevMode,
    devMihomoMode,
    devMihomoSecret: env.DEV_MIHOMO_SECRET ?? "",
    schedulerEnabled: !localDevMode,
    safeApplyMode: localDevMode && !devMihomoMode,
    dataNamespace: localDevMode ? "dev" : "default",
  };
}

export function getDevMihomoPaths(cwd = process.cwd()): DevMihomoPaths {
  const rootDir = path.join(cwd, DEV_MIHOMO_RELATIVE_ROOT);
  const homeDir = path.join(rootDir, "home");
  const externalController = `127.0.0.1:${DEV_MIHOMO_CONTROLLER_PORT}`;

  return {
    rootDir,
    homeDir,
    configFile: path.join(homeDir, "config.yaml"),
    controllerUrl: `http://${externalController}`,
    externalController,
  };
}
