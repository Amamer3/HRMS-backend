import "dotenv/config";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";

const env = loadEnv();
const app = createApp(env);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${env.PORT}`);
});
