import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CredentialStoreError,
  JsonPermissionApprovalStore,
  MacOSKeychainCredentialStore,
  MemoryCredentialStore,
  MemoryPermissionApprovalStore,
  PermissionBroker,
  PermissionBrokerError,
  createKeychainCredentialIdentifiers,
  diffPermissions,
  normalizePermissions,
} from "./index.ts";

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("normalizes permission entries and computes least-privilege coverage", () => {
  const requested = normalizePermissions({
    network: [" API.Example.com. ", "api.example.com"],
    secrets: [" github ", "github"],
    filesystem: [
      { path: "/tmp/project/", access: "read" },
      { path: "/tmp/project", access: "write" },
      { path: "/tmp/other", access: "read" },
    ],
  });
  assert.deepEqual(requested, {
    network: ["api.example.com"],
    secrets: ["github"],
    filesystem: [
      { path: "/tmp/other", access: "read" },
      { path: "/tmp/project", access: "write" },
    ],
  });

  const state = diffPermissions(requested, {
    network: ["example.com"],
    secrets: ["other"],
    filesystem: [{ path: "/tmp", access: "read" }],
  });
  assert.deepEqual(state.granted, {
    network: ["api.example.com"],
    filesystem: [{ path: "/tmp/other", access: "read" }],
  });
  assert.deepEqual(state.missing, {
    secrets: ["github"],
    filesystem: [{ path: "/tmp/project", access: "write" }],
  });
});

test("approves only a selected subset and never auto-grants inspection", async () => {
  const broker = new PermissionBroker(new MemoryPermissionApprovalStore());
  const requested = {
    network: ["api.example.com", "calendar.example.com"],
    secrets: ["github"],
  };

  const before = await broker.inspect("com.example.calendar", requested);
  assert.deepEqual(before.granted, {});
  assert.deepEqual(before.missing, {
    network: ["api.example.com", "calendar.example.com"],
    secrets: ["github"],
  });

  const after = await broker.approve("com.example.calendar", {
    network: ["api.example.com"],
  });
  assert.deepEqual(after.granted, { network: ["api.example.com"] });
  assert.deepEqual(after.missing, {
    network: ["calendar.example.com"],
    secrets: ["github"],
  });
  await assert.rejects(
    broker.approve("com.example.calendar", { network: ["unrequested.example.com"] }),
    (error: unknown) => error instanceof PermissionBrokerError && error.code === "PERMISSION_NOT_REQUESTED",
  );
});

test("detects a newly requested permission against existing approval", async () => {
  const store = new MemoryPermissionApprovalStore({
    "com.example.github": { network: ["api.github.com"] },
  });
  const broker = new PermissionBroker(store);
  const state = await broker.inspect("com.example.github", {
    network: ["api.github.com", "uploads.github.com"],
  });

  assert.deepEqual(state.granted, { network: ["api.github.com"] });
  assert.deepEqual(state.missing, { network: ["uploads.github.com"] });
});

test("persists approvals atomically, preserves unknown fields, and revokes grants", async () => {
  const root = await temporaryDirectory();
  const filePath = path.join(root, "state", "permissions.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({
      schemaVersion: 0,
      preserved: { keep: true },
      plugins: {
        "com.example.github": {
          custom: "keep",
          permissions: { network: ["api.github.com"], future: { keep: true } },
        },
      },
    }),
    "utf8",
  );

  const store = new JsonPermissionApprovalStore(filePath);
  const broker = new PermissionBroker(store);
  await broker.inspect("com.example.github", { network: ["api.github.com"] });
  await broker.approve("com.example.github", { network: ["api.github.com"] });

  const reloaded = new PermissionBroker(new JsonPermissionApprovalStore(filePath));
  const approved = await reloaded.inspect("com.example.github", { network: ["api.github.com"] });
  assert.deepEqual(approved.missing, {});

  await reloaded.revoke("com.example.github", { network: ["api.github.com"] });
  const afterRevoke = await new JsonPermissionApprovalStore(filePath).load();
  assert.equal(afterRevoke["com.example.github"], undefined);
  const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
    preserved: { keep: boolean };
    plugins: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(persisted.preserved, { keep: true });
  assert.equal(persisted.plugins["com.example.github"].custom, "keep");
  assert.deepEqual(persisted.plugins["com.example.github"].permissions, { future: { keep: true } });
});

test("requires permission approval before secret use and exposes only approved grants", async () => {
  const broker = new PermissionBroker(new MemoryPermissionApprovalStore());
  const requested = { secrets: ["github", "calendar"] };
  await assert.rejects(
    broker.requireApproval("com.example.provider", requested),
    (error: unknown) => {
      return (
        error instanceof PermissionBrokerError &&
        error.code === "PERMISSION_APPROVAL_REQUIRED" &&
        error.state?.missing.secrets?.join(",") === "calendar,github"
      );
    },
  );
  await broker.approve("com.example.provider", { secrets: ["github"] });
  await assert.rejects(broker.requireApproval("com.example.provider", requested));
  await broker.approve("com.example.provider", { secrets: ["calendar"] });
  assert.deepEqual(await broker.requireApproval("com.example.provider", requested), {
    secrets: ["calendar", "github"],
  });
});

test("round-trips credentials in memory with namespaced isolation", async () => {
  const store = new MemoryCredentialStore();
  await store.set("com.example.github", "token", "secret-value");
  assert.equal(await store.get("com.example.github", "token"), "secret-value");
  await store.delete("com.example.github", "token");
  await assert.rejects(
    store.get("com.example.github", "token"),
    (error: unknown) => error instanceof CredentialStoreError && error.code === "CREDENTIAL_NOT_FOUND",
  );
});

test("uses injected security command arguments for Keychain round trips", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const values = new Map<string, string>();
  const executeFile = async (file: string, args: readonly string[]) => {
    calls.push({ file, args: [...args] });
    const command = args[0];
    const account = args[args.indexOf("-a") + 1];
    const service = args[args.indexOf("-s") + 1];
    const key = `${service}:${account}`;
    if (command === "add-generic-password") {
      values.set(key, args[args.indexOf("-w") + 1]);
      return {};
    }
    if (command === "find-generic-password") {
      const value = values.get(key);
      if (value === undefined) {
        throw Object.assign(new Error("missing secret-value should not leak"), { code: 44 });
      }
      return { stdout: `${value}\n` };
    }
    values.delete(key);
    return {};
  };
  const store = new MacOSKeychainCredentialStore({ execFile: executeFile });
  const reference = { pluginId: "com.example.github", name: "token" };
  const identifiers = createKeychainCredentialIdentifiers(reference);
  const secret = "secret-value with spaces; never shell-evaluated";

  await store.set(reference, secret);
  assert.deepEqual(calls[0], {
    file: "/usr/bin/security",
    args: [
      "add-generic-password",
      "-a",
      identifiers.account,
      "-s",
      identifiers.service,
      "-w",
      secret,
      "-U",
    ],
  });
  assert.equal(await store.get(reference), secret);
  await store.delete(reference);
  await assert.rejects(store.get(reference), (error: unknown) => {
    return (
      error instanceof CredentialStoreError &&
      error.code === "CREDENTIAL_NOT_FOUND" &&
      !error.message.includes(secret)
    );
  });
  assert.deepEqual(calls.at(-1), {
    file: "/usr/bin/security",
    args: [
      "find-generic-password",
      "-a",
      identifiers.account,
      "-s",
      identifiers.service,
      "-w",
    ],
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "queuest-plugin-permissions-"));
  temporaryDirectories.push(directory);
  return directory;
}
