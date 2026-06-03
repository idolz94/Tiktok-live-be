import { createApp } from "./app.js";
import { assertRequiredEnv, env } from "./config/env.js";

assertRequiredEnv();

const app = createApp();

app.listen(env.port, () => {
  console.log(`Lumi backend is running at http://localhost:${env.port}`);
});
