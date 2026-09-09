import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { JsonObject, PluginPermissions } from "@queuest/plugin-contracts";
import {
  MemoryCredentialStore,
} from "@queuest/plugin-permissions";
import {
  GITHUB_ACCEPT_HEADER,
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_PLUGIN_ID,
  GithubPluginError,
  GithubRestClient,
  createGithubPluginHandlers,
} from "./index.ts";

const approvedPermissions: PluginPermissions = {
  network: ["api.github.com"],
  secrets: ["github"],
};

test("declares the process entrypoint and the least-privilege GitHub permissions", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  ) as {
    id: string;
    entry: { type: string; command: string; args?: string[] };
    permissions: PluginPermissions;
  };

  assert.equal(manifest.id, GITHUB_PLUGIN_ID);
  assert.deepEqual(manifest.entry, {
    type: "process",
    command: "node",
    args: ["--experimental-strip-types", "bin/queuest-github.mjs"],
  });
  assert.deepEqual(manifest.permissions, approvedPermissions);
});

test("sends fixed GitHub headers and namespaced bearer credentials", async () => {
  const credentials = new MemoryCredentialStore();
  await credentials.set(GITHUB_PLUGIN_ID, "connection-1", "top-secret-token");
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new GithubRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return jsonResponse([]);
    },
  });

  await client.listWorkItems({ connectionId: "connection-1", repository: "octo/hello" });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${GITHUB_API_BASE_URL}/repos/octo/hello/issues?state=all&per_page=100&page=1`,
  );
  assert.deepEqual(calls[0].init.headers, {
    Accept: GITHUB_ACCEPT_HEADER,
    Authorization: "Bearer top-secret-token",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "Queuest GitHub Plugin/0.1.0",
  });
});

test("paginates with numeric cursors, filters pull requests, and maps issues", async () => {
  const credentials = new MemoryCredentialStore({
    [`${GITHUB_PLUGIN_ID}\u0000connection-1`]: "token",
  });
  const calls: string[] = [];
  const client = new GithubRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async (url) => {
      calls.push(url);
      return jsonResponse(
        [
          {
            id: 101,
            number: 7,
            title: "Fix queue",
            body: "A body",
            state: "open",
            html_url: "https://github.com/octo/hello/issues/7",
            updated_at: "2026-09-09T00:00:00Z",
            labels: [{ name: "bug" }, { name: "queue" }],
          },
          {
            id: 102,
            number: 8,
            title: "Pull request",
            body: "skip me",
            state: "open",
            html_url: "https://github.com/octo/hello/pull/8",
            pull_request: { url: "https://api.github.com/repos/octo/hello/pulls/8" },
            labels: [],
          },
        ],
        200,
        { link: '<https://api.github.com/repos/octo/hello/issues?page=2>; rel="next"' },
      );
    },
  });

  const firstPage = await client.listWorkItems({
    connectionId: "connection-1",
    repository: "octo/hello",
  });
  assert.deepEqual(firstPage, {
    items: [
      {
        providerId: "github",
        connectionId: "connection-1",
        externalId: "101",
        externalRef: "github:octo/hello#7",
        sourceUrl: "https://github.com/octo/hello/issues/7",
        title: "Fix queue",
        body: "A body",
        status: "open",
        updatedAt: "2026-09-09T00:00:00Z",
        labels: ["bug", "queue"],
      },
    ],
    nextCursor: "2",
  });

  await client.listWorkItems({
    connectionId: "connection-1",
    repository: "octo/hello",
    cursor: firstPage.nextCursor,
  });
  assert.equal(calls[1].endsWith("state=all&per_page=100&page=2"), true);
});

test("rejects arbitrary repository URLs and non-numeric page cursors", async () => {
  let fetchCalls = 0;
  const credentials = new MemoryCredentialStore({
    [`${GITHUB_PLUGIN_ID}\u0000connection-1`]: "token",
  });
  const client = new GithubRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", repository: "https://evil.example/x" }),
    (error: unknown) => error instanceof GithubPluginError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", repository: "octo/hello", cursor: "https://evil.example" }),
    (error: unknown) => error instanceof GithubPluginError && error.code === "INVALID_INPUT",
  );
  assert.equal(fetchCalls, 0);
});

test("denies API and credential use until both permissions are approved", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const credentials = {
    get: async () => {
      credentialCalls += 1;
      throw new Error("must not read credentials");
    },
  } as unknown as MemoryCredentialStore;
  const client = new GithubRestClient({
    credentialStore: credentials,
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", repository: "octo/hello" }),
    (error: unknown) => error instanceof GithubPluginError && error.code === "PERMISSION_DENIED",
  );
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("maps missing credentials to needs-auth without exposing credential values", async () => {
  let fetchCalls = 0;
  const secret = "never-log-this-token";
  const credentials = new MemoryCredentialStore();
  const client = new GithubRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ login: "unused" });
    },
  });

  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", repository: "octo/hello" }),
    (error: unknown) => {
      return (
        error instanceof GithubPluginError &&
        error.code === "CREDENTIAL_NOT_FOUND" &&
        !error.message.includes(secret)
      );
    },
  );
  assert.deepEqual(await client.connectionStatus("connection-1"), {
    state: "needs-auth",
    message: "GitHub 인증 정보가 없습니다.",
  });
  assert.equal(fetchCalls, 0);
});

test("redacts arbitrary credential and fetch failures", async () => {
  const secret = "secret-value-must-not-escape";
  const credentials = {
    get: async () => {
      throw new Error(`credential backend echoed ${secret}`);
    },
  } as unknown as MemoryCredentialStore;
  const client = new GithubRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async () => {
      throw new Error(`fetch echoed ${secret}`);
    },
  });

  await assert.rejects(
    client.listWorkItems({ connectionId: "connection-1", repository: "octo/hello" }),
    (error: unknown) => {
      return (
        error instanceof GithubPluginError &&
        error.code === "CREDENTIAL_ERROR" &&
        !error.message.includes(secret) &&
        !("cause" in error)
      );
    },
  );

  const workingCredentials = new MemoryCredentialStore({
    [`${GITHUB_PLUGIN_ID}\u0000connection-1`]: "token",
  });
  const networkClient = new GithubRestClient({
    credentialStore: workingCredentials,
    grantedPermissions: approvedPermissions,
    fetch: async () => {
      throw new Error(`fetch echoed ${secret}`);
    },
  });
  await assert.rejects(
    networkClient.listWorkItems({ connectionId: "connection-1", repository: "octo/hello" }),
    (error: unknown) => {
      return (
        error instanceof GithubPluginError &&
        error.code === "NETWORK_ERROR" &&
        !error.message.includes(secret) &&
        !("cause" in error)
      );
    },
  );
});

test("maps auth, not-found, rate-limit, HTTP, and malformed responses safely", async (t) => {
  const statuses: Array<{ status: number; headers?: Record<string, string>; code: string }> = [
    { status: 401, code: "AUTH_ERROR" },
    { status: 404, code: "NOT_FOUND" },
    { status: 403, headers: { "x-ratelimit-remaining": "0" }, code: "RATE_LIMITED" },
    { status: 500, code: "HTTP_ERROR" },
  ];
  for (const expected of statuses) {
    await t.test(expected.code, async () => {
      const credentials = new MemoryCredentialStore({
        [`${GITHUB_PLUGIN_ID}\u0000connection-1`]: "token",
      });
      const client = new GithubRestClient({
        credentialStore: credentials,
        grantedPermissions: approvedPermissions,
        fetch: async () => jsonResponse({ message: "provider detail" }, expected.status, expected.headers),
      });
      assert.deepEqual(await client.connectionStatus("connection-1"), {
        state: expected.code === "AUTH_ERROR" ? "needs-auth" : "error",
        message: expected.code === "AUTH_ERROR"
          ? "GitHub 인증을 확인해 주세요."
          : expected.code === "NOT_FOUND"
            ? "GitHub 연결 대상을 찾지 못했습니다."
            : expected.code === "RATE_LIMITED"
              ? "GitHub API 요청 한도를 초과했습니다."
              : "GitHub API가 HTTP 500 오류를 반환했습니다.",
      });
    });
  }

  const credentials = new MemoryCredentialStore({
    [`${GITHUB_PLUGIN_ID}\u0000connection-1`]: "token",
  });
  const malformedClient = new GithubRestClient({
    credentialStore: credentials,
    grantedPermissions: approvedPermissions,
    fetch: async () => jsonResponse({ nope: true }),
  });
  await assert.rejects(
    malformedClient.listWorkItems({ connectionId: "connection-1", repository: "octo/hello" }),
    (error: unknown) => error instanceof GithubPluginError && error.code === "MALFORMED_RESPONSE",
  );
});

test("process handlers enforce initialization and preserve connection states", async () => {
  const credentials = new MemoryCredentialStore({
    [`${GITHUB_PLUGIN_ID}\u0000connection-1`]: "token",
  });
  const handlers = createGithubPluginHandlers({
    credentialStore: credentials,
    fetch: async () => jsonResponse({ login: "octocat" }),
  });

  assert.deepEqual(
    await handlers.healthCheck?.({}),
    { state: "error", message: "GitHub 플러그인이 초기화되지 않았습니다." },
  );
  assert.deepEqual(
    await handlers.initialize?.({
      grantedPermissions: approvedPermissions as unknown as JsonObject,
    }),
    { initialized: true },
  );
  assert.deepEqual(await handlers.healthCheck?.({}), { state: "connected" });
  assert.deepEqual(await handlers.connectionStatus?.({ connectionId: "connection-1" }), {
    state: "connected",
    accountLabel: "octocat",
  });
  assert.deepEqual(await handlers.shutdown?.({}), { shutdown: true });
});

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
