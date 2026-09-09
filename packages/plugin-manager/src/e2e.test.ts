import assert from "node:assert/strict";
import { spawn as spawnChildProcess, type SpawnOptions } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import os from "node:os";
import path from "node:path";
import type { JsonObject } from "@queuest/plugin-contracts";
import {
  MemoryPermissionApprovalStore,
  PermissionBroker,
} from "@queuest/plugin-permissions";
import {
  MemoryPluginStateStore,
  PluginManager,
  PluginManagerError,
  PluginPermissionApprovalError,
  type PluginRecord,
  type PluginProcess,
  type PluginSpawn,
} from "./index.ts";

const fixtureDirectory = fileURLToPath(new URL("../test-fixtures/mock-plugin", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("discovers built-in and user roots and reports invalid or incompatible manifests", async () => {
  const root = await temporaryDirectory();
  const builtinRoot = path.join(root, "builtins");
  const userRoot = path.join(root, "user");
  await copyFixture(path.join(builtinRoot, "mock"));
  await copyFixture(path.join(userRoot, "user-mock"));
  await updateManifest(path.join(userRoot, "user-mock", "manifest.json"), {
    id: "com.queuest.mock.user",
    name: "Queuest User Mock Plugin",
  });
  await writeManifest(path.join(userRoot, "invalid", "manifest.json"), {
    schemaVersion: 1,
    id: "com.queuest.invalid",
    name: "Invalid Mock Plugin",
    version: "1.0.0",
    hostApi: "^1.0.0",
    entry: { type: "process", command: "node" },
    capabilities: ["not-a-capability"],
  });
  await writeManifest(path.join(userRoot, "future", "manifest.json"), {
    schemaVersion: 1,
    id: "com.queuest.future",
    name: "Future Mock Plugin",
    version: "1.0.0",
    hostApi: "^2.0.0",
    entry: { type: "process", command: "node" },
    capabilities: ["source.work-items"],
  });

  const manager = new PluginManager({
    hostVersion: "1.0.0",
    builtinDirectories: [builtinRoot],
    userDirectories: [userRoot],
    stateStore: new MemoryPluginStateStore(),
  });
  const selected = await manager.discover();
  const all = manager.listAllPlugins();

  assert.equal(selected.some((plugin) => plugin.id === "com.queuest.mock" && plugin.source === "builtin"), true);
  assert.equal(selected.some((plugin) => plugin.id === "com.queuest.mock.user" && plugin.source === "user"), true);
  assert.equal(all.some((plugin) => plugin.state === "invalid" && plugin.id === "com.queuest.invalid"), true);
  assert.equal(all.some((plugin) => plugin.state === "incompatible" && plugin.id === "com.queuest.future"), true);
  await assert.rejects(manager.activatePlugin("com.queuest.future"), (error: unknown) => {
    return error instanceof PluginManagerError && error.code === "HOST_API_INCOMPATIBLE";
  });
});

test("runs the repository mock plugin through a real process lifecycle", async () => {
  const root = await temporaryDirectory();
  const builtinRoot = path.join(root, "builtins");
  const pluginDirectory = path.join(builtinRoot, "mock");
  const statePath = path.join(root, "state", "plugins.json");
  await copyFixture(pluginDirectory);
  const warnings: string[] = [];
  const manager = new PluginManager({
    hostVersion: "1.0.0",
    builtinDirectories: [builtinRoot],
    userDirectories: [path.join(root, "user")],
    statePath,
    logger: { warn: (message) => warnings.push(message) },
  });

  const discovered = await manager.discover();
  const initial = getRecord(discovered, "com.queuest.mock");
  assert.equal(initial.installed, true);
  assert.equal(initial.enabled, false);
  assert.equal(initial.state, "disabled");

  await manager.disablePlugin("com.queuest.mock");
  assert.equal(manager.getPlugin("com.queuest.mock")?.state, "disabled");
  await manager.enablePlugin("com.queuest.mock");
  assert.equal(manager.getPlugin("com.queuest.mock")?.state, "enabled");
  await manager.uninstallPlugin("com.queuest.mock");
  assert.equal(manager.getPlugin("com.queuest.mock")?.state, "not-installed");
  assert.equal(await fileExists(pluginDirectory), true);
  await manager.installPlugin("com.queuest.mock");
  assert.equal(manager.getPlugin("com.queuest.mock")?.state, "disabled");

  const transport = await manager.activatePlugin("com.queuest.mock");
  const child = transport.process as (typeof transport.process & { pid?: number; exitCode?: number | null });
  assert.equal(transport.status, "running");
  assert.equal(typeof child?.pid, "number");
  assert.deepEqual(
    await manager.requestPlugin<{ state: string; label: string }>(
      "com.queuest.mock",
      "health.check",
      { label: "warmup" },
    ),
    { state: "connected", label: "warmup" },
  );

  const slow = manager.requestPlugin<{ state: string; label: string }>(
    "com.queuest.mock",
    "health.check",
    { label: "slow", delayMs: 30 },
  );
  const fast = manager.requestPlugin<{ state: string; label: string }>(
    "com.queuest.mock",
    "health.check",
    { label: "fast", delayMs: 0 },
  );
  assert.deepEqual(await Promise.all([slow, fast]), [
    { state: "connected", label: "slow" },
    { state: "connected", label: "fast" },
  ]);
  assert.equal(warnings.some((message) => message.includes("mock-plugin:initialize")), true);
  assert.equal(warnings.some((message) => message.includes("mock-plugin:health.check")), true);

  await manager.shutdown();
  assert.equal(transport.status, "stopped");
  assert.equal(child?.exitCode, 0);
  assert.equal(warnings.some((message) => message.includes("mock-plugin:shutdown")), true);
  assert.equal(manager.getTransport("com.queuest.mock"), undefined);
  const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
    plugins: Record<string, { enabled: boolean }>;
  };
  assert.equal(persisted.plugins["com.queuest.mock"].enabled, true);
});

test("requires approval before running a permissioned real mock plugin", async () => {
  const root = await temporaryDirectory();
  const builtinRoot = path.join(root, "builtins");
  const pluginDirectory = path.join(builtinRoot, "permissioned-mock");
  const pluginId = "com.queuest.mock.permissioned";
  const requestedPermissions = {
    network: ["api.example.com"],
    secrets: ["github"],
  };
  await copyFixture(pluginDirectory);
  await updateManifest(path.join(pluginDirectory, "manifest.json"), {
    id: pluginId,
    name: "Queuest Permissioned Mock Plugin",
    permissions: requestedPermissions,
  });
  const warnings: string[] = [];
  const manager = new PluginManager({
    hostVersion: "1.0.0",
    builtinDirectories: [builtinRoot],
    userDirectories: [path.join(root, "user")],
    stateStore: new MemoryPluginStateStore(),
    permissionBroker: new PermissionBroker(new MemoryPermissionApprovalStore()),
    logger: { warn: (message) => warnings.push(message) },
  });

  await manager.discover();
  await assert.rejects(manager.activatePlugin(pluginId), (error: unknown) => {
    return error instanceof PluginPermissionApprovalError && error.code === "PLUGIN_PERMISSION_APPROVAL_REQUIRED";
  });
  assert.equal(manager.getTransport(pluginId), undefined);
  assert.equal(warnings.some((message) => message.includes("mock-plugin:initialize")), false);

  await manager.approvePluginPermissions(pluginId, { network: ["api.example.com"] });
  assert.deepEqual(await manager.getApprovedPluginPermissions(pluginId), {
    network: ["api.example.com"],
  });
  await assert.rejects(manager.activatePlugin(pluginId), PluginPermissionApprovalError);
  assert.equal(manager.getTransport(pluginId), undefined);

  await manager.approvePluginPermissions(pluginId, { secrets: ["github"] });
  assert.deepEqual(await manager.getApprovedPluginPermissions(pluginId), requestedPermissions);
  const transport = await manager.activatePlugin(pluginId);
  assert.deepEqual(
    await manager.requestPlugin<{ state: string; label: string }>(
      pluginId,
      "health.check",
      { label: "permissioned" },
    ),
    { state: "connected", label: "permissioned" },
  );
  assert.equal(
    warnings.some((message) =>
      message.includes(`mock-plugin:initialize-granted:${JSON.stringify(requestedPermissions)}`),
    ),
    true,
  );

  await manager.shutdown();
  assert.equal(transport.status, "stopped");
  assert.equal(warnings.some((message) => message.includes("mock-plugin:shutdown")), true);
});

test("runs the GitHub plugin through the manager process boundary after approval", async () => {
  const pluginDirectory = fileURLToPath(new URL("../../plugin-github", import.meta.url));
  const pluginId = "com.queuest.github";
  const requestedPermissions = {
    network: ["api.github.com"],
    secrets: ["github"],
  };
  const spawnCalls: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
  const spawn: PluginSpawn = (command, args, options) => {
    spawnCalls.push({ command, args: [...args], options });
    return spawnChildProcess(command, [...args], options) as unknown as PluginProcess;
  };
  const manager = new PluginManager({
    hostVersion: "1.0.0",
    directories: [{ path: pluginDirectory, source: "builtin" }],
    stateStore: new MemoryPluginStateStore(),
    permissionBroker: new PermissionBroker(new MemoryPermissionApprovalStore()),
    spawnProcess: spawn,
    initializeOnActivate: false,
  });

  const discovered = await manager.discover();
  const record = getRecord(discovered, pluginId);
  assert.equal(record.source, "builtin");
  assert.equal(record.manifest?.entry.command, "node");
  assert.deepEqual(record.manifest?.permissions, requestedPermissions);
  assert.deepEqual((await manager.inspectPluginPermissions(pluginId)).missing, requestedPermissions);

  await assert.rejects(manager.activatePlugin(pluginId), (error: unknown) => {
    return error instanceof PluginPermissionApprovalError && error.code === "PLUGIN_PERMISSION_APPROVAL_REQUIRED";
  });
  assert.equal(spawnCalls.length, 0, "permission denial must happen before a child process starts");
  assert.equal(manager.getTransport(pluginId), undefined);

  await manager.approvePluginPermissions(pluginId, requestedPermissions);
  const transport = await manager.activatePlugin(pluginId);
  assert.equal(transport.status, "running");
  const child = transport.process as (PluginProcess & { pid?: number; exitCode?: number | null }) | undefined;
  assert.equal(typeof child?.pid, "number");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "node");
  assert.deepEqual(spawnCalls[0].args, ["--experimental-strip-types", "bin/queuest-github.mjs"]);
  assert.notEqual(spawnCalls[0].options.shell, true, "PluginManager must launch without a shell");

  const initialize = await manager.requestPlugin<{ initialized: boolean }>(
    pluginId,
    "initialize",
    {
      host: {
        protocolVersion: 1,
        appId: "com.yoonhogo.queuest",
        appVersion: "1.0.0",
      },
      grantedPermissions: requestedPermissions,
    } as unknown as JsonObject,
  );
  assert.deepEqual(initialize, { initialized: true });
  assert.deepEqual(
    await manager.requestPlugin<{ state: string }>(pluginId, "health.check", {}),
    { state: "connected" },
  );

  await manager.shutdown();
  assert.equal(transport.status, "stopped");
  assert.equal(child?.exitCode, 0);
  assert.equal(manager.getTransport(pluginId), undefined);
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "queuest-plugin-e2e-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function copyFixture(targetDirectory: string): Promise<void> {
  await cp(fixtureDirectory, targetDirectory, { recursive: true });
}

async function updateManifest(
  manifestPath: string,
  changes: { id: string; name: string; permissions?: unknown },
): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, ...changes }, null, 2)}\n`,
    "utf8",
  );
}

async function writeManifest(manifestPath: string, manifest: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function getRecord(records: readonly PluginRecord[], id: string): PluginRecord {
  const record = records.find((plugin) => plugin.id === id);
  assert.ok(record);
  return record;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
