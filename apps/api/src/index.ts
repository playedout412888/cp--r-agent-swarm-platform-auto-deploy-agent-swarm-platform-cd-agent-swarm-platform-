import "dotenv/config";
import { createPool, loadConfig } from "../../../packages/orchestration/src/index.js";
import { buildApp } from "./server.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp(pool);

await app.listen({ host: config.bind, port: config.port });
app.log.info(`control plane api listening on http://${config.bind}:${config.port}`);
