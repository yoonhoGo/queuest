import { MacOSKeychainCredentialStore } from "@queuest/plugin-permissions";
import { servePlugin } from "@queuest/plugin-sdk";
import { createCalendarPluginHandlers } from "../src/index.ts";

servePlugin(
  createCalendarPluginHandlers({
    credentialStore: new MacOSKeychainCredentialStore(),
  }),
);
