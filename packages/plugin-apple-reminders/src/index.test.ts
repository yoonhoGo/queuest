import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { JsonObject } from "@queuest/plugin-contracts";
import {
  APPLE_REMINDERS_CAPABILITY,
  APPLE_REMINDERS_ERROR_CODES,
  APPLE_REMINDERS_PLUGIN_ID,
  APPLE_REMINDERS_PLATFORM_PERMISSION,
  AppleRemindersPluginError,
  createAppleRemindersPluginHandlers,
} from "./index.ts";

test("declares a platform-only, read-only Apple Reminders manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8")) as {
    id: string;
    entry: { type: string; command: string; args?: string[] };
    capabilities: string[];
    permissions: { platform: string[] };
  };
  assert.equal(manifest.id, APPLE_REMINDERS_PLUGIN_ID);
  assert.deepEqual(manifest.entry, {
    type: "process",
    command: "node",
    args: ["--experimental-strip-types", "bin/queuest-apple-reminders.mjs"],
  });
  assert.deepEqual(manifest.capabilities, [APPLE_REMINDERS_CAPABILITY]);
  assert.deepEqual(manifest.permissions, { platform: [APPLE_REMINDERS_PLATFORM_PERMISSION] });
});

test("maps source.work-items to read-only Apple Reminders records", async () => {
  let query: unknown;
  const handlers = createAppleRemindersPluginHandlers({ client: {
    initialize: async () => ({ initialized: true }),
    healthCheck: async () => ({ state: "connected" as const }),
    connectionStatus: async () => ({ state: "connected" as const }),
    tccStatus: async () => ({ authorizationStatus: "fullAccess" } as JsonObject),
    requestTccAccess: async () => ({ authorizationStatus: "fullAccess" } as JsonObject),
    listCalendarEvents: async () => ({ items: [] }),
    listWorkItems: async (value) => {
      query = value;
      return {
        items: [{
          providerId: "apple-reminders",
          connectionId: "local",
          externalId: "reminder-1",
          externalRef: "apple-reminders:reminder-1",
          sourceUrl: "x-apple-reminders://reminder/reminder-1",
          title: "Buy milk",
          body: "",
          status: "open" as const,
        }],
      };
    },
    shutdown: async () => undefined,
  } });
  await handlers.initialize?.({
    grantedPermissions: { platform: [APPLE_REMINDERS_PLATFORM_PERMISSION] },
  });
  const result = await handlers.listWorkItems?.({
    connectionId: "local",
    repository: "Inbox",
    cursor: "0",
  });
  assert.deepEqual(result, {
    items: [{
      providerId: "apple-reminders",
      connectionId: "local",
      externalId: "reminder-1",
      externalRef: "apple-reminders:reminder-1",
      sourceUrl: "x-apple-reminders://reminder/reminder-1",
      title: "Buy milk",
      body: "",
      status: "open",
    }],
  });
  assert.deepEqual(query, { connectionId: "local", repository: "Inbox", cursor: "0" });
});

test("keeps TCC denial typed and does not silently request access on reads", async () => {
  let requestAccessCalls = 0;
  const handlers = createAppleRemindersPluginHandlers({ client: {
    initialize: async () => ({ initialized: true }),
    healthCheck: async () => ({ state: "needs-auth" as const, message: "권한 필요" }),
    connectionStatus: async () => ({ state: "needs-auth" as const }),
    tccStatus: async () => ({ authorizationStatus: "notDetermined" } as JsonObject),
    requestTccAccess: async () => {
      requestAccessCalls += 1;
      throw new AppleRemindersPluginError(
        APPLE_REMINDERS_ERROR_CODES.tccNotDetermined,
        "Apple Reminders 접근 권한 요청이 필요합니다.",
      );
    },
    listCalendarEvents: async () => ({ items: [] }),
    listWorkItems: async () => {
      throw new AppleRemindersPluginError(
        APPLE_REMINDERS_ERROR_CODES.tccNotDetermined,
        "Apple Reminders 접근 권한 요청이 필요합니다.",
      );
    },
    shutdown: async () => undefined,
  } });
  await handlers.initialize?.({
    grantedPermissions: { platform: [APPLE_REMINDERS_PLATFORM_PERMISSION] },
  });
  const list = Promise.resolve(handlers.listWorkItems?.({ connectionId: "local" }));
  await assert.rejects(
    list,
    (error: unknown) => error instanceof AppleRemindersPluginError && error.code === APPLE_REMINDERS_ERROR_CODES.tccNotDetermined,
  );
  assert.equal(requestAccessCalls, 0);
});
