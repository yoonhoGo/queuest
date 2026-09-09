import { MacOSKeychainCredentialStore } from "@queuest/plugin-permissions";
import { servePlugin } from "@queuest/plugin-sdk";
import { createGithubPluginHandlers } from "../src/index.ts";

servePlugin(
  createGithubPluginHandlers({
    credentialStore: new MacOSKeychainCredentialStore(),
  }),
);
