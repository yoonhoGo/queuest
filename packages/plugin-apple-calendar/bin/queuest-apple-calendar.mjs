import { servePlugin } from "@queuest/plugin-sdk";
import { createAppleCalendarPluginHandlers } from "../src/index.ts";

servePlugin(createAppleCalendarPluginHandlers());
