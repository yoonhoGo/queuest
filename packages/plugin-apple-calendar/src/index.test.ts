import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  CalendarQuery,
  ConnectionStatus,
  ExternalCalendarEvent,
  ExternalWorkItem,
  JsonObject,
  Page,
  WorkItemQuery,
} from "@queuest/plugin-contracts";
import { dispatchPluginRequest } from "@queuest/plugin-sdk";
import {
  APPLE_CALENDAR_CAPABILITY,
  APPLE_CALENDAR_ERROR_CODES,
  APPLE_CALENDAR_PLUGIN_ID,
  APPLE_CALENDAR_PLATFORM_PERMISSION,
  AppleCalendarPluginError,
  createAppleCalendarPluginHandlers,
} from "./index.ts";
import type { EventKitNativeClientLike } from "@queuest/plugin-eventkit";

test("declares a platform-only, read-only Apple Calendar manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8")) as {
    id: string;
    entry: { type: string; command: string; args?: string[] };
    capabilities: string[];
    permissions: { platform: string[] };
  };
  assert.equal(manifest.id, APPLE_CALENDAR_PLUGIN_ID);
  assert.deepEqual(manifest.entry, {
    type: "process",
    command: "node",
    args: ["--experimental-strip-types", "bin/queuest-apple-calendar.mjs"],
  });
  assert.deepEqual(manifest.capabilities, [APPLE_CALENDAR_CAPABILITY]);
  assert.deepEqual(manifest.permissions, { platform: [APPLE_CALENDAR_PLATFORM_PERMISSION] });
});

test("requires the Apple Calendar platform grant before native initialization", async () => {
  let initializeCalls = 0;
  const handlers = createAppleCalendarPluginHandlers({ client: fakeClient({
    initialize: async () => {
      initializeCalls += 1;
      return { initialized: true };
    },
  }) });
  const initialize = Promise.resolve(handlers.initialize?.({ grantedPermissions: {} }));
  await assert.rejects(
    initialize,
    (error: unknown) => error instanceof AppleCalendarPluginError && error.code === APPLE_CALENDAR_ERROR_CODES.permissionDenied,
  );
  assert.equal(initializeCalls, 0);
});

test("maps source.calendar-events through the shared native client boundary", async () => {
  const calls: JsonObject[] = [];
  const handlers = createAppleCalendarPluginHandlers({ client: fakeClient({
    initialize: async (params) => {
      calls.push(params);
      return { initialized: true };
    },
    listCalendarEvents: async () => ({
      items: [{
        providerId: "apple-calendar",
        connectionId: "local",
        externalId: "event-1",
        calendarId: "work",
        title: "Planning",
        startsAt: "2026-09-09T10:00:00Z",
        endsAt: "2026-09-09T11:00:00Z",
        allDay: false,
        status: "confirmed" as const,
      }],
    }),
  }) });
  await handlers.initialize?.({
    grantedPermissions: { platform: [" MACOS.EVENTKIT.CALENDAR "] },
  });
  const response = await dispatchPluginRequest(
    {
      protocolVersion: 1,
      id: "calendar-list",
      method: "source.calendar-events.list",
      params: {
        connectionId: "local",
        calendarIds: ["work"],
        startsAt: "2026-09-09T00:00:00Z",
        endsAt: "2026-09-10T00:00:00Z",
      },
    },
    handlers,
  );
  assert.equal("result" in response, true);
  assert.deepEqual("result" in response ? response.result : undefined, {
    items: [{
      providerId: "apple-calendar",
      connectionId: "local",
      externalId: "event-1",
      calendarId: "work",
      title: "Planning",
      startsAt: "2026-09-09T10:00:00Z",
      endsAt: "2026-09-09T11:00:00Z",
      allDay: false,
      status: "confirmed",
    }],
  });
  assert.deepEqual(calls[0]?.grantedPermissions, { platform: [APPLE_CALENDAR_PLATFORM_PERMISSION] });
});

test("returns a sanitized typed TCC error over the protocol", async () => {
  const handlers = createAppleCalendarPluginHandlers({ client: fakeClient({
    tccStatus: async () => {
      throw new AppleCalendarPluginError(
        APPLE_CALENDAR_ERROR_CODES.tccDenied,
        "Apple Calendar 접근 권한이 거부되었습니다.",
      );
    },
  }) });
  await handlers.initialize?.({
    grantedPermissions: { platform: [APPLE_CALENDAR_PLATFORM_PERMISSION] },
  });
  const response = await dispatchPluginRequest(
    { protocolVersion: 1, id: "tcc", method: "tcc.status", params: {} },
    handlers,
  );
  assert.deepEqual(response, {
    protocolVersion: 1,
    id: "tcc",
    error: {
      code: APPLE_CALENDAR_ERROR_CODES.tccDenied,
      message: "Apple Calendar 접근 권한이 거부되었습니다.",
    },
  });
});

function fakeClient(overrides: Partial<EventKitNativeClientLike>): EventKitNativeClientLike {
  const client: EventKitNativeClientLike = {
    initialize: async () => ({ initialized: true }),
    healthCheck: async (): Promise<ConnectionStatus> => ({ state: "connected" }),
    connectionStatus: async (): Promise<ConnectionStatus> => ({ state: "connected" }),
    tccStatus: async () => ({ authorizationStatus: "fullAccess" }),
    requestTccAccess: async () => ({ authorizationStatus: "fullAccess" }),
    listCalendarEvents: async (_query: CalendarQuery): Promise<Page<ExternalCalendarEvent>> => ({ items: [] }),
    listWorkItems: async (_query: WorkItemQuery): Promise<Page<ExternalWorkItem>> => ({ items: [] }),
    shutdown: async () => undefined,
    ...overrides,
  };
  return client;
}
