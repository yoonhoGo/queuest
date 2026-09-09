import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { JsonObject, PluginPermissions } from "@queuest/plugin-contracts";
import { MemoryCredentialStore } from "@queuest/plugin-permissions";
import {
  JIRA_ACCEPT_HEADER,
  JIRA_CONTENT_TYPE,
  JIRA_ERROR_CODES,
  JIRA_MAX_NEXT_PAGE_TOKEN_LENGTH,
  JIRA_MYSELF_PATH,
  JIRA_NETWORK_PERMISSION,
  JIRA_PAGE_SIZE,
  JIRA_PLUGIN_ID,
  JIRA_SEARCH_PATH,
  JIRA_SECRET_PERMISSION,
  JIRA_USER_AGENT,
  JiraPluginError,
  JiraRestClient,
  buildJiraProjectJql,
  createJiraPluginHandlers,
  validateJiraSiteUrl,
} from "./index.ts";

const approvedPermissions: PluginPermissions = {
  network: [JIRA_NETWORK_PERMISSION],
  secrets: [JIRA_SECRET_PERMISSION],
};

test("declares the process entrypoint, Jira identity, and least-privilege permissions", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  ) as {
    id: string;
    capabilities: string[];
    entry: { type: string; command: string; args?: string[] };
    permissions: PluginPermissions;
  };
  const entrypoint = await readFile(new URL("../bin/queuest-jira.mjs", import.meta.url), "utf8");

  assert.equal(manifest.id, JIRA_PLUGIN_ID);
  assert.deepEqual(manifest.capabilities, ["source.work-items"]);
  assert.deepEqual(manifest.entry, {
    type: "process",
    command: "node",
    args: ["--experimental-strip-types", "bin/queuest-jira.mjs"],
  });
  assert.deepEqual(manifest.permissions, approvedPermissions);
  assert.equal(entrypoint.includes("shell"), false);
});

test("sends Jira v3 search requests with Basic auth, JSON headers, and a stable user agent", async () => {
  const credentials = credentialStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new JiraRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return jsonResponse({ issues: [], isLast: true });
    },
  });

  await client.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://acme.atlassian.net${JIRA_SEARCH_PATH}`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, {
    Accept: JIRA_ACCEPT_HEADER,
    Authorization: `Basic ${Buffer.from("alice@example.com:api-token", "utf8").toString("base64")}`,
    "Content-Type": JIRA_CONTENT_TYPE,
    "User-Agent": JIRA_USER_AGENT,
  });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    jql: 'project = "OPS" ORDER BY updated DESC',
    maxResults: JIRA_PAGE_SIZE,
    fields: ["summary", "description", "labels", "updated", "status"],
  });
});

test("canonicalizes only HTTPS Atlassian Cloud origins and rejects host/path/port injection", () => {
  assert.equal(validateJiraSiteUrl("https://Acme.atlassian.net/"), "https://acme.atlassian.net");
  for (const value of [
    "http://acme.atlassian.net",
    "https://atlassian.net",
    "https://acme.atlassian.net.evil.example",
    "https://acme.atlassian.net:443",
    "https://acme.atlassian.net:8443",
    "https://acme.atlassian.net/jira",
    "https://acme.atlassian.net/..",
    "https://user:password@acme.atlassian.net",
    "https://acme.atlassian.net?redirect=https://evil.example",
    "https://acme.atlassian.net#fragment",
  ]) {
    assert.throws(
      () => validateJiraSiteUrl(value),
      (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.invalidInput,
    );
  }
});

test("uses opaque bounded nextPageToken cursors and maps ADF, labels, browse URLs, and status categories", async () => {
  const credentials = credentialStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let responseNumber = 0;
  const client = new JiraRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      responseNumber += 1;
      if (responseNumber === 1) {
        return jsonResponse({
          issues: [
            jiraIssue("10001", "OPS-1", "Open issue", "new", {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: "First" }] },
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Second" },
                    { type: "hardBreak" },
                    { type: "text", text: "line" },
                  ],
                },
              ],
            }),
          ],
          nextPageToken: "opaque-token-1",
          isLast: false,
        });
      }
      return jsonResponse({
        issues: [
          jiraIssue("10002", "OPS-2", "In progress issue", "indeterminate", "plain text"),
          jiraIssue("10003", "OPS-3", "Done issue", "done", null),
        ],
        isLast: true,
      });
    },
  });

  const firstPage = await client.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" });
  assert.equal(firstPage.nextCursor, "opaque-token-1");
  assert.deepEqual(firstPage.items[0], {
    providerId: "jira",
    connectionId: "connection-1",
    externalId: "10001",
    externalRef: "jira:acme.atlassian.net/OPS-1",
    sourceUrl: "https://acme.atlassian.net/browse/OPS-1",
    title: "Open issue",
    body: "First\nSecond\nline",
    status: "open",
    labels: ["queue", "sync"],
    updatedAt: "2026-09-09T00:00:00.000Z",
  });

  const secondPage = await client.listWorkItems({
    connectionId: "connection-1",
    projectKey: "OPS",
    cursor: firstPage.nextCursor,
  });
  assert.equal(secondPage.nextCursor, undefined);
  assert.equal(secondPage.items[0].status, "in_progress");
  assert.equal(secondPage.items[0].body, "plain text");
  assert.equal(secondPage.items[1].status, "closed");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)).nextPageToken, "opaque-token-1");
  assert.equal(calls.every(({ url }) => url === `https://acme.atlassian.net${JIRA_SEARCH_PATH}`), true);

  await assert.rejects(
    client.listWorkItems({
      connectionId: "connection-1",
      projectKey: "OPS",
      cursor: "x".repeat(JIRA_MAX_NEXT_PAGE_TOKEN_LENGTH + 1),
    }),
    (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.invalidInput,
  );
  assert.equal(calls.length, 2, "an invalid cursor must not issue another request");
});

test("builds a safe project JQL and rejects JQL injection", () => {
  assert.equal(buildJiraProjectJql("TEAM_1"), 'project = "TEAM_1" ORDER BY updated DESC');
  assert.throws(
    () => buildJiraProjectJql("TEAM OR project = OTHER"),
    (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.invalidInput,
  );
});

test("denies both API and credential use until both manifest permissions are granted", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const client = new JiraRestClient({
    credentialStore: {
      get: async () => {
        credentialCalls += 1;
        throw new Error("must not read credentials");
      },
    } as never,
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ issues: [], isLast: true });
    },
  });

  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.permissionDenied,
  );
  assert.deepEqual(await client.connectionStatus("connection-1"), {
    state: "error",
    message: "Jira 플러그인의 API 및 credential 권한 승인이 필요합니다.",
  });
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("maps missing and malformed JSON credentials to safe needs-auth states", async () => {
  const missing = new JiraRestClient({
    credentialStore: new MemoryCredentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ issues: [], isLast: true }),
  });
  await assert.rejects(
    missing.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.credentialNotFound,
  );
  assert.deepEqual(await missing.connectionStatus("connection-1"), {
    state: "needs-auth",
    message: "Jira 인증 정보가 없습니다.",
  });

  const malformedStore = new MemoryCredentialStore({
    [`${JIRA_PLUGIN_ID}\u0000connection-1`]: JSON.stringify({
      siteUrl: "https://acme.atlassian.net/project/OPS",
      email: "alice@example.com",
      apiToken: "secret-token",
    }),
  });
  const malformed = new JiraRestClient({
    credentialStore: malformedStore,
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ issues: [], isLast: true }),
  });
  await assert.rejects(
    malformed.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.malformedCredential,
  );
  assert.deepEqual(await malformed.connectionStatus("connection-1"), {
    state: "needs-auth",
    message: "Jira 인증 정보 형식이 올바르지 않습니다.",
  });
});

test("redacts credential and fetch failures without retaining secret causes", async () => {
  const secret = "secret-value-must-not-escape";
  const credentialFailure = new JiraRestClient({
    credentialStore: {
      get: async () => {
        throw new Error(`credential backend echoed ${secret}`);
      },
    } as never,
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ issues: [], isLast: true }),
  });
  await assert.rejects(
    credentialFailure.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => {
      return error instanceof JiraPluginError &&
        error.code === JIRA_ERROR_CODES.credentialError &&
        !error.message.includes(secret) &&
        !("cause" in error);
    },
  );

  const workingCredentials = credentialStore();
  const networkFailure = new JiraRestClient({
    credentialStore: workingCredentials,
    grantedPermissions: approvedPermissions,
    fetch: async () => {
      throw new Error(`fetch echoed ${secret}`);
    },
  });
  await assert.rejects(
    networkFailure.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => {
      return error instanceof JiraPluginError &&
        error.code === JIRA_ERROR_CODES.network &&
        !error.message.includes(secret) &&
        !("cause" in error);
    },
  );
});

test("maps auth, not-found, rate-limit, HTTP, and malformed API responses safely", async (t) => {
  const cases: Array<{ status: number; code: string }> = [
    { status: 401, code: JIRA_ERROR_CODES.auth },
    { status: 404, code: JIRA_ERROR_CODES.notFound },
    { status: 429, code: JIRA_ERROR_CODES.rateLimit },
    { status: 500, code: JIRA_ERROR_CODES.http },
  ];
  for (const expected of cases) {
    await t.test(expected.code, async () => {
      const client = new JiraRestClient({
        credentialStore: credentialStore(),
        grantedPermissions: approvedPermissions,
        fetch: async () => jsonResponse({ message: "provider detail" }, expected.status),
      });
      await assert.rejects(
        client.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
        (error: unknown) => error instanceof JiraPluginError && error.code === expected.code,
      );
      const status = await client.connectionStatus("connection-1");
      assert.equal(status.state, expected.code === JIRA_ERROR_CODES.auth ? "needs-auth" : "error");
    });
  }

  const malformedClient = new JiraRestClient({
    credentialStore: credentialStore(),
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ issues: [] }),
  });
  await assert.rejects(
    malformedClient.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => error instanceof JiraPluginError && error.code === JIRA_ERROR_CODES.malformedResponse,
  );
});

test("handlers enforce initialization while health.check stays offline after initialize", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const credentials = new MemoryCredentialStore();
  await credentials.set(
    JIRA_PLUGIN_ID,
    "connection-1",
    JSON.stringify({
      siteUrl: "https://acme.atlassian.net",
      email: "alice@example.com",
      apiToken: "api-token",
    }),
  );
  const trackedStore = {
    get: async (pluginId: string, connectionId: string) => {
      credentialCalls += 1;
      return credentials.get(pluginId, connectionId);
    },
  } as never;
  const handlers = createJiraPluginHandlers({
    credentialStore: trackedStore,
    fetch: async (url) => {
      fetchCalls += 1;
      if (url.endsWith(JIRA_MYSELF_PATH)) {
        return jsonResponse({ displayName: "Alice" });
      }
      return jsonResponse({ issues: [], isLast: true });
    },
  });

  assert.deepEqual(await handlers.healthCheck?.({}), {
    state: "error",
    message: "Jira 플러그인이 초기화되지 않았습니다.",
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
    accountLabel: "Alice",
  });
  assert.equal(credentialCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(await handlers.shutdown?.({}), { shutdown: true });
  assert.deepEqual(await handlers.healthCheck?.({}), {
    state: "error",
    message: "Jira 플러그인이 초기화되지 않았습니다.",
  });
});

test("does not expose API tokens in malformed response errors", async () => {
  const token = "token-not-for-logs";
  const client = new JiraRestClient({
    credentialStore: new MemoryCredentialStore({
      [`${JIRA_PLUGIN_ID}\u0000connection-1`]: JSON.stringify({
        baseUrl: "https://acme.atlassian.net",
        email: "alice@example.com",
        apiToken: token,
      }),
    }),
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({
      issues: [{
        id: "10001",
        key: "OPS-1",
        fields: {
          summary: "broken",
          description: { type: "unexpected", token },
          labels: [],
          updated: "2026-09-09T00:00:00Z",
          status: { statusCategory: { key: "new" } },
        },
      }],
      isLast: true,
    }),
  });
  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", projectKey: "OPS" }),
    (error: unknown) => error instanceof JiraPluginError &&
      error.code === JIRA_ERROR_CODES.malformedResponse &&
      !error.message.includes(token),
  );
});

function credentialStore(): MemoryCredentialStore {
  return new MemoryCredentialStore({
    [`${JIRA_PLUGIN_ID}\u0000connection-1`]: JSON.stringify({
      siteUrl: "https://acme.atlassian.net/",
      email: "alice@example.com",
      apiToken: "api-token",
    }),
  });
}

function jiraIssue(
  id: string,
  key: string,
  summary: string,
  statusCategory: string,
  description: unknown,
): JsonObject {
  return {
    id,
    key,
    fields: {
      summary,
      description: description as never,
      labels: ["queue", "sync"],
      updated: "2026-09-09T00:00:00.000Z",
      status: { statusCategory: { key: statusCategory } },
    },
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
