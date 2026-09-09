import { servePlugin } from "@queuest/plugin-sdk";
import { createAppleRemindersPluginHandlers } from "../src/index.ts";

servePlugin(createAppleRemindersPluginHandlers());
