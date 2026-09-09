import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { JsonObject, PluginPermissions } from "@queuest/plugin-contracts";
import { MemoryCredentialStore } from "@queuest/plugin-permissions";
import {
  CALENDAR_ACCEPT_HEADER,
  CALENDAR_API_BASE_URL,
  CALENDAR_ERROR_CODES,
  CALENDAR_EVENTS_PATH,
  CALENDAR_MAX_PAGE_TOKEN_LENGTH,
  CALENDAR_NETWORK_PERMISSION,
  CALENDAR_PAGE_SIZE,
  CALENDAR_PLUGIN_ID,
  CALENDAR_SECRET_PERMISSION,
  CALENDAR_USER_AGENT,
  CalendarPluginError,
  CalendarRestClient,
  createCalendarPluginHandlers,
  mapCalendarEvent,
  parseCalendarCredential,
  parseCalendarQuery,
} from "./index.ts";

const approvedPermissions: PluginPermissions = {
  network: [CALENDAR_NETWORK_PERMISSION],
  secrets: [CALENDAR_SECRET_PERMISSION],
};

test("declares the Google Calendar process entrypoint and least-privilege permissions", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  ) as {
    id: string;
    capabilities: string[];
    entry: { type: string; command: string; args?: string[] };
    permissions: PluginPermissions;
  };
  const entrypoint = await readFile(new URL("../bin/queuest-calendar.mjs", import.meta.url), "utf8");

  assert.equal(manifest.id, CALENDAR_PLUGIN_ID);
  assert.deepEqual(manifest.capabilities, ["source.calendar-events"]);
  assert.deepEqual(manifest.entry, {
    type: "process",
    command: "node",
    args: ["--experimental-strip-types", "bin/queuest-calendar.mjs"],
  });
  assert.deepEqual(manifest.permissions, approvedPermissions);
  assert.equal(entrypoint.includes("shell"), false);
});

test("sends events.list requests with fixed Google Calendar URL, bearer auth, and query bounds", async () => {
  const credentials = credentialStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new CalendarRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return jsonResponse({ items: [] });
    },
  });

  await client.listCalendarEvents({
    connectionId: "connection-1",
    calendarIds: ["primary"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
  });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, CALENDAR_API_BASE_URL);
  assert.equal(url.pathname, `${CALENDAR_EVENTS_PATH}/primary/events`);
  assert.equal(url.searchParams.get("timeMin"), "2026-09-09T00:00:00Z");
  assert.equal(url.searchParams.get("timeMax"), "2026-09-10T00:00:00Z");
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.equal(url.searchParams.get("orderBy"), "startTime");
  assert.equal(url.searchParams.get("maxResults"), String(CALENDAR_PAGE_SIZE));
  assert.deepEqual(calls[0].init.headers, {
    Accept: CALENDAR_ACCEPT_HEADER,
    Authorization: "Bearer access-token",
    "User-Agent": CALENDAR_USER_AGENT,
  });
});

test("maps timed and all-day events and forwards bounded nextPageToken cursors", async () => {
  const calls: string[] = [];
  let responseNumber = 0;
  const client = new CalendarRestClient({
    credentialStore: credentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async (url) => {
      calls.push(url);
      responseNumber += 1;
      if (responseNumber === 1) {
        return jsonResponse({
          items: [
            calendarEvent("timed-1", {
              summary: "Planning",
              start: { dateTime: "2026-09-09T10:00:00+09:00" },
              end: { dateTime: "2026-09-09T11:00:00+09:00" },
              status: "tentative",
              htmlLink: "https://calendar.google.com/event?eid=timed-1",
              updated: "2026-09-08T20:00:00.000Z",
            }),
            calendarEvent("all-day-1", {
              summary: "Holiday",
              start: { date: "2026-09-10" },
              end: { date: "2026-09-11" },
              status: "confirmed",
            }),
          ],
          nextPageToken: "next-page-token",
        });
      }
      return jsonResponse({
        items: [calendarEvent("cancelled-1", {
          summary: "Cancelled",
          start: { dateTime: "2026-09-09T12:00:00Z" },
          end: { dateTime: "2026-09-09T13:00:00Z" },
          status: "cancelled",
        })],
      });
    },
  });

  const firstPage = await client.listCalendarEvents({
    connectionId: "connection-1",
    calendarIds: ["primary"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
  });
  assert.equal(firstPage.nextCursor, "next-page-token");
  assert.deepEqual(firstPage.items, [
    {
      providerId: "google-calendar",
      connectionId: "connection-1",
      externalId: "timed-1",
      calendarId: "primary",
      title: "Planning",
      startsAt: "2026-09-09T10:00:00+09:00",
      endsAt: "2026-09-09T11:00:00+09:00",
      allDay: false,
      status: "tentative",
      sourceUrl: "https://calendar.google.com/event?eid=timed-1",
      updatedAt: "2026-09-08T20:00:00.000Z",
    },
    {
      providerId: "google-calendar",
      connectionId: "connection-1",
      externalId: "all-day-1",
      calendarId: "primary",
      title: "Holiday",
      startsAt: "2026-09-10",
      endsAt: "2026-09-11",
      allDay: true,
      status: "confirmed",
    },
  ]);

  const secondPage = await client.listCalendarEvents({
    connectionId: "connection-1",
    calendarIds: ["primary"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
    cursor: firstPage.nextCursor,
  });
  assert.equal(secondPage.nextCursor, undefined);
  assert.equal(secondPage.items[0].status, "cancelled");
  assert.equal(new URL(calls[1]).searchParams.get("pageToken"), "next-page-token");
});

test("supports multiple calendars with an opaque cursor that does not repeat finished pages", async () => {
  const calls: string[] = [];
  let primaryPage = 0;
  const responses = new Map<string, unknown>([
    ["primary", { items: [calendarEvent("primary-1", {})], nextPageToken: "primary-next" }],
    ["team@example.com", { items: [calendarEvent("team-1", {})] }],
  ]);
  const client = new CalendarRestClient({
    credentialStore: credentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async (url) => {
      calls.push(url);
      const calendarId = new URL(url).pathname.split("/").at(-2) ?? "";
      const normalizedCalendarId = calendarId === "team%40example.com" ? "team@example.com" : calendarId;
      const body = normalizedCalendarId === "primary" && primaryPage++ > 0
        ? { items: [calendarEvent("primary-2", {})] }
        : responses.get(normalizedCalendarId);
      return jsonResponse(body ?? { items: [] });
    },
  });

  const firstPage = await client.listCalendarEvents({
    connectionId: "connection-1",
    calendarIds: ["primary", "team@example.com"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
  });
  assert.equal(typeof firstPage.nextCursor, "string");
  assert.equal(calls.length, 2);

  const secondPage = await client.listCalendarEvents({
    connectionId: "connection-1",
    calendarIds: ["primary", "team@example.com"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
    cursor: firstPage.nextCursor,
  });
  assert.equal(secondPage.nextCursor, undefined);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[2]).searchParams.get("pageToken"), "primary-next");
});

test("denies API and credential use until both permissions are granted", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const client = new CalendarRestClient({
    credentialStore: {
      get: async () => {
        credentialCalls += 1;
        throw new Error("must not read credentials");
      },
    } as never,
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ items: [] });
    },
  });

  await assert.rejects(
    client.listCalendarEvents({
      connectionId: "connection-1",
      calendarIds: ["primary"],
      startsAt: "2026-09-09T00:00:00Z",
      endsAt: "2026-09-10T00:00:00Z",
    }),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.permissionDenied,
  );
  assert.deepEqual(await client.connectionStatus("connection-1"), {
    state: "error",
    message: "Calendar 플러그인의 API 및 credential 권한 승인이 필요합니다.",
  });
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("maps missing and malformed JSON credentials to safe needs-auth states", async () => {
  const missing = new CalendarRestClient({
    credentialStore: new MemoryCredentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ items: [] }),
  });
  await assert.rejects(
    missing.listCalendarEvents(query()),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.credentialNotFound,
  );
  assert.deepEqual(await missing.connectionStatus("connection-1"), {
    state: "needs-auth",
    message: "Calendar 인증 정보가 없습니다.",
  });

  const malformedStore = new MemoryCredentialStore({
    [`${CALENDAR_PLUGIN_ID}\u0000connection-1`]: JSON.stringify({ accessToken: "" }),
  });
  const malformed = new CalendarRestClient({
    credentialStore: malformedStore,
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ items: [] }),
  });
  await assert.rejects(
    malformed.listCalendarEvents(query()),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.malformedCredential,
  );
  assert.deepEqual(await malformed.connectionStatus("connection-1"), {
    state: "needs-auth",
    message: "Calendar 인증 정보 형식이 올바르지 않습니다.",
  });
});

test("redacts credential and fetch failures", async () => {
  const secret = "secret-value-must-not-escape";
  const credentialFailure = new CalendarRestClient({
    credentialStore: {
      get: async () => {
        throw new Error(`credential backend echoed ${secret}`);
      },
    } as never,
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ items: [] }),
  });
  await assert.rejects(
    credentialFailure.listCalendarEvents(query()),
    (error: unknown) => error instanceof CalendarPluginError &&
      error.code === CALENDAR_ERROR_CODES.credentialError &&
      !error.message.includes(secret) &&
      !("cause" in error),
  );

  const networkFailure = new CalendarRestClient({
    credentialStore: credentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async () => {
      throw new Error(`fetch echoed ${secret}`);
    },
  });
  await assert.rejects(
    networkFailure.listCalendarEvents(query()),
    (error: unknown) => error instanceof CalendarPluginError &&
      error.code === CALENDAR_ERROR_CODES.network &&
      !error.message.includes(secret) &&
      !("cause" in error),
  );
});

test("maps auth, not-found, rate-limit, HTTP, and malformed API responses safely", async (t) => {
  const cases: Array<{ status: number; code: string }> = [
    { status: 401, code: CALENDAR_ERROR_CODES.auth },
    { status: 404, code: CALENDAR_ERROR_CODES.notFound },
    { status: 429, code: CALENDAR_ERROR_CODES.rateLimit },
    { status: 500, code: CALENDAR_ERROR_CODES.http },
  ];
  for (const expected of cases) {
    await t.test(expected.code, async () => {
      const client = new CalendarRestClient({
        credentialStore: credentialStore(),
        grantedPermissions: approvedPermissions,
        fetch: async () => jsonResponse({ error: { token: "provider-detail" } }, expected.status),
      });
      await assert.rejects(
        client.listCalendarEvents(query()),
        (error: unknown) => error instanceof CalendarPluginError && error.code === expected.code,
      );
      const status = await client.connectionStatus("connection-1");
      assert.equal(status.state, expected.code === CALENDAR_ERROR_CODES.auth ? "needs-auth" : "error");
    });
  }

  const malformedClient = new CalendarRestClient({
    credentialStore: credentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ items: [{ id: "broken" }] }),
  });
  await assert.rejects(
    malformedClient.listCalendarEvents(query()),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.malformedResponse,
  );
});

test("handlers enforce initialization while health.check remains offline", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const credentials = credentialStore();
  const trackedStore = {
    get: async (pluginId: string, connectionId: string) => {
      credentialCalls += 1;
      return credentials.get(pluginId, connectionId);
    },
  } as never;
  const handlers = createCalendarPluginHandlers({
    credentialStore: trackedStore,
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ summary: "Primary" });
    },
  });

  assert.deepEqual(await handlers.healthCheck?.({}), {
    state: "error",
    message: "Calendar 플러그인이 초기화되지 않았습니다.",
  });
  assert.deepEqual(
    await handlers.initialize?.({ grantedPermissions: approvedPermissions as unknown as JsonObject }),
    { initialized: true },
  );
  assert.deepEqual(await handlers.healthCheck?.({}), { state: "connected" });
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await handlers.connectionStatus?.({ connectionId: "connection-1" }), {
    state: "connected",
    accountLabel: "Primary",
  });
  assert.equal(credentialCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(await handlers.shutdown?.({}), { shutdown: true });
  assert.deepEqual(await handlers.healthCheck?.({}), {
    state: "error",
    message: "Calendar 플러그인이 초기화되지 않았습니다.",
  });
});

test("rejects URL injection, invalid ranges, oversized cursors, and malformed credentials", () => {
  assert.throws(
    () => parseCalendarQuery({
      ...query(),
      calendarIds: ["primary/events?calendarId=https://evil.example"],
    }),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.invalidInput,
  );
  assert.throws(
    () => parseCalendarQuery({
      ...query(),
      startsAt: "2026-09-11T00:00:00Z",
      endsAt: "2026-09-10T00:00:00Z",
    }),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.invalidInput,
  );
  assert.throws(
    () => parseCalendarQuery({ ...query(), cursor: "x".repeat(CALENDAR_MAX_PAGE_TOKEN_LENGTH + 1) }),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.invalidInput,
  );
  assert.throws(
    () => parseCalendarCredential({ accessToken: "token\u0000value" }),
    (error: unknown) => error instanceof CalendarPluginError && error.code === CALENDAR_ERROR_CODES.malformedCredential,
  );
});

test("maps direct event records with a supplied connection ID", () => {
  assert.deepEqual(
    mapCalendarEvent(
      calendarEvent("event-1", {
        summary: "Direct mapping",
        start: { date: "2026-09-09" },
        end: { date: "2026-09-10" },
      }),
      "primary",
      "connection-1",
    ),
    {
      providerId: "google-calendar",
      connectionId: "connection-1",
      externalId: "event-1",
      calendarId: "primary",
      title: "Direct mapping",
      startsAt: "2026-09-09",
      endsAt: "2026-09-10",
      allDay: true,
      status: "confirmed",
    },
  );
});

function query(): {
  connectionId: string;
  calendarIds: string[];
  startsAt: string;
  endsAt: string;
} {
  return {
    connectionId: "connection-1",
    calendarIds: ["primary"],
    startsAt: "2026-09-09T00:00:00Z",
    endsAt: "2026-09-10T00:00:00Z",
  };
}

function credentialStore(): MemoryCredentialStore {
  return new MemoryCredentialStore({
    [`${CALENDAR_PLUGIN_ID}\u0000connection-1`]: JSON.stringify({ accessToken: "access-token" }),
  });
}

function calendarEvent(id: string, overrides: JsonObject = {}): JsonObject {
  return {
    id,
    summary: "Event",
    start: { dateTime: "2026-09-09T10:00:00Z" },
    end: { dateTime: "2026-09-09T11:00:00Z" },
    status: "confirmed",
    ...overrides,
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}
