import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import type {
  JsonObject,
  PluginResponse,
} from "@queuest/plugin-contracts";
import {
  APPLE_CALENDAR_PLATFORM_PERMISSION,
  EVENTKIT_ERROR_CODES,
  EventKitNativeClient,
  EventKitPluginError,
  createEventKitPluginHandlers,
  parseCalendarQuery,
  parseGrantedPermissions,
  parseWorkItemQuery,
} from "./index.ts";
import type { EventKitProcess, EventKitSpawn } from "./index.ts";

test("normalizes and gates platform permissions at the handler boundary", () => {
  const permissions = parseGrantedPermissions(
    { platform: [" MACOS.EVENTKIT.CALENDAR "] },
    "calendar",
  );
  assert.deepEqual(permissions, { platform: [APPLE_CALENDAR_PLATFORM_PERMISSION] });
  assert.throws(
    () => parseGrantedPermissions({ platform: ["macos.eventkit.reminders"] }, "calendar"),
    (error: unknown) => error instanceof EventKitPluginError && error.code === EVENTKIT_ERROR_CODES.permissionDenied,
  );
});

test("validates the shared calendar and reminder query contracts", () => {
  assert.deepEqual(
    parseCalendarQuery({
      connectionId: "local",
      calendarIds: ["work"],
      startsAt: "2026-09-09T00:00:00Z",
      endsAt: "2026-09-10T00:00:00Z",
      cursor: "250",
    }),
    {
      connectionId: "local",
      calendarIds: ["work"],
      startsAt: "2026-09-09T00:00:00Z",
      endsAt: "2026-09-10T00:00:00Z",
      cursor: "250",
    },
  );
  assert.deepEqual(
    parseWorkItemQuery({ connectionId: "local", repository: "Inbox", cursor: "0" }),
    { connectionId: "local", repository: "Inbox", cursor: "0" },
  );
  assert.throws(
    () => parseCalendarQuery({
      connectionId: "local",
      calendarIds: ["work"],
      startsAt: "2026-09-10T00:00:00Z",
      endsAt: "2026-09-09T00:00:00Z",
    }),
    (error: unknown) => error instanceof EventKitPluginError && error.code === EVENTKIT_ERROR_CODES.invalidInput,
  );
});

test("correlates the native JSONL process and maps typed TCC errors", async () => {
  const responses: PluginResponse[] = [];
  const spawn: EventKitSpawn = ((command, args, options) => {
    assert.equal(command, "/tmp/eventkit");
    assert.deepEqual(args, ["--resource", "calendar"]);
    assert.equal(options.cwd, "/tmp");
    return new FakeEventKitProcess((request, process) => {
      if (request.method === "initialize") {
        process.respond({ protocolVersion: 1, id: request.id, result: { initialized: true } });
      } else if (request.method === "health.check") {
        process.respond({ protocolVersion: 1, id: request.id, result: { state: "connected" } });
      } else if (request.method === "connection.status") {
        process.respond({
          protocolVersion: 1,
          id: request.id,
          error: { code: "TCC_DENIED", message: "ignored by the client" },
        });
      } else if (request.method === "tcc.status") {
        process.respond({
          protocolVersion: 1,
          id: request.id,
          result: { resource: "calendar", authorizationStatus: "denied", readAccess: false },
        });
      } else if (request.method === "source.calendar-events.list") {
        process.respond({
          protocolVersion: 1,
          id: request.id,
          result: {
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
          },
        });
      } else if (request.method === "shutdown") {
        process.respond({ protocolVersion: 1, id: request.id, result: { shutdown: true } });
      }
    }) as unknown as EventKitProcess;
  }) as EventKitSpawn;

  const client = new EventKitNativeClient({
    resource: "calendar",
    binaryPath: "/tmp/eventkit",
    cwd: "/tmp",
    spawnProcess: spawn,
    requestId: (() => {
      let count = 0;
      return () => `request-${++count}`;
    })(),
  });
  await client.initialize({
    grantedPermissions: { platform: [APPLE_CALENDAR_PLATFORM_PERMISSION] },
  } as JsonObject);
  assert.deepEqual(await client.healthCheck(), { state: "connected" });
  assert.deepEqual(await client.tccStatus(), {
    resource: "calendar",
    authorizationStatus: "denied",
    readAccess: false,
  });
  assert.deepEqual(await client.listCalendarEvents({
    connectionId: "local",
    calendarIds: ["work"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
  }), {
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
  assert.deepEqual(await client.connectionStatus("local"), {
    state: "needs-auth",
    message: "Apple Calendar 접근 권한이 거부되었습니다.",
  });
  await client.shutdown();
  assert.equal(responses.length, 0);
});

test("creates read-only handlers that pass only the normalized platform grant", async () => {
  const calls: JsonObject[] = [];
  const client = {
    initialize: async (params: JsonObject) => {
      calls.push(params);
      return { initialized: true };
    },
    healthCheck: async () => ({ state: "connected" as const }),
    connectionStatus: async () => ({ state: "connected" as const }),
    tccStatus: async () => ({ authorizationStatus: "fullAccess" } as JsonObject),
    requestTccAccess: async () => ({ authorizationStatus: "fullAccess" } as JsonObject),
    listCalendarEvents: async () => ({ items: [] }),
    listWorkItems: async () => ({ items: [] }),
    shutdown: async () => undefined,
  };
  const handlers = createEventKitPluginHandlers({ resource: "calendar", client });
  assert.deepEqual(await handlers.initialize?.({
    grantedPermissions: { platform: [" MACOS.EVENTKIT.CALENDAR "] },
  }), { initialized: true });
  assert.deepEqual(calls[0]?.grantedPermissions, { platform: [APPLE_CALENDAR_PLATFORM_PERMISSION] });
  assert.deepEqual(await handlers.listCalendarEvents?.({
    connectionId: "local",
    calendarIds: ["work"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
  }), { items: [] });
});

interface FakeRequest {
  id: string;
  method: string;
  params: JsonObject;
}

class FakeEventKitProcess extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public killed = false;
  private buffer = "";
  private readonly onRequest: (request: FakeRequest, process: FakeEventKitProcess) => void;

  public constructor(onRequest: (request: FakeRequest, process: FakeEventKitProcess) => void) {
    super();
    this.onRequest = onRequest;
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          this.onRequest(JSON.parse(line) as FakeRequest, this);
        }
      }
    });
    this.stdin.on("finish", () => {
      if (!this.killed) {
        this.emit("exit", 0, null);
        this.emit("close", 0, null);
      }
    });
  }

  public respond(response: PluginResponse): void {
    this.stdout.write(`${JSON.stringify(response)}\n`);
  }

  public kill(): boolean {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    this.emit("close", null, "SIGTERM");
    return true;
  }
}
