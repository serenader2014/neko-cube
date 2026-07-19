import cron, { type ScheduledTask } from "node-cron";
import { getAppSettings, type DatabaseContext } from "../db/database.js";
import type { JobService } from "./job-service.js";

function intervalToExpression(minutes: number): string {
  if (minutes <= 1) {
    return "* * * * *";
  }

  if (minutes < 60) {
    return `*/${minutes} * * * *`;
  }

  const hours = Math.max(1, Math.floor(minutes / 60));
  return `0 */${hours} * * *`;
}

export function createScheduler(context: DatabaseContext, jobs: JobService) {
  let task: ScheduledTask | null = null;

  async function reschedule() {
    if (task) {
      task.stop();
      task.destroy();
      task = null;
    }

    const settings = await getAppSettings(context);
    const expression = intervalToExpression(settings.refreshIntervalMinutes);

    task = cron.schedule(expression, async () => {
      if (jobs.isRunning()) {
        return;
      }

      try {
        await jobs.buildAndApplyConfig();
      } catch (error) {
        console.error("[scheduler] build_and_apply_config failed", error);
      }
    });
  }

  async function start() {
    await reschedule();
  }

  function stop() {
    if (task) {
      task.stop();
      task.destroy();
      task = null;
    }
  }

  return {
    start,
    stop,
    reschedule,
  };
}
