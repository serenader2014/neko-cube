import fs from "node:fs";
import path from "node:path";

export type AppPaths = {
  cwd: string;
  dataDir: string;
  compiledDir: string;
  databaseFile: string;
  latestConfigFile: string;
  lastSuccessfulConfigFile: string;
};

export function getAppPaths(cwd = process.cwd(), namespace = "default"): AppPaths {
  const dataDir = path.join(cwd, "data", namespace);
  const compiledDir = path.join(dataDir, "compiled");

  fs.mkdirSync(compiledDir, { recursive: true });

  return {
    cwd,
    dataDir,
    compiledDir,
    databaseFile: path.join(dataDir, "app.db"),
    latestConfigFile: path.join(compiledDir, "latest.yaml"),
    lastSuccessfulConfigFile: path.join(compiledDir, "last-success.yaml"),
  };
}
