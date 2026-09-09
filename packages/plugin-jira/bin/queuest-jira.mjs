import { MacOSKeychainCredentialStore } from "@queuest/plugin-permissions";
import { servePlugin } from "@queuest/plugin-sdk";
import { createJiraPluginHandlers } from "../src/index.ts";

servePlugin(
  createJiraPluginHandlers({
    credentialStore: new MacOSKeychainCredentialStore(),
  }),
);
