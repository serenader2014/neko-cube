import { type Client } from "@libsql/client";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { type AppPaths } from "../lib/paths.js";
import { type RuntimeConfig } from "../lib/runtime.js";
import { type SourceSnapshot } from "../../shared/types.js";

export type AppDatabase = LibSQLDatabase<Record<string, never>>;

export type SourceSnapshotSummary = {
  sourceId: number;
  status: SourceSnapshot["status"];
  fetchedAt: string;
  proxyCount: number;
  error: string | null;
};

export type DatabaseContext = {
  sqlite: Client;
  db: AppDatabase;
  paths: AppPaths;
  runtime: RuntimeConfig;
};
