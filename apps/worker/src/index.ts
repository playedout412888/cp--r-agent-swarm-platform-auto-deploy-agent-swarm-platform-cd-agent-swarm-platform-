import "dotenv/config";
import {
  createPool,
  loadConfig,
  processNextJob,
  SEED,
} from "../../../packages/orchestration/src/index.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const workspaceId = process.env.CONTROL_PLANE_WORKSPACE_ID ?? SEED.workspaceId;

async function loop(): Promise<void> {
  for (;;) {
    const job = await processNextJob(pool, workspaceId);
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

loop().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
