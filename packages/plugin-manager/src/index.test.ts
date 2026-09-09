import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, test } from "node:test";
import os from "node:os";
import path from "node:path";
import type {
  JsonObject,
  PluginManifest,
  PluginResponse,
} from "@queuest/plugin-contracts";
import {
  discoverPlugins,
  isHostApiCompatible,
  MemoryPluginStateStore,
  PluginManager,
  PluginManagerError,
  PluginTransport,
  resolvePluginEntryPath,
  type PluginProcess,
  type PluginSpawn,
} from "./index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("discovers built-in and user plugin roots and validates manifests", async () => {
  const root = await temporaryDirectory();
  const builtinRoot = path.join(root, "builtins");
  const userRoot = path.join(root, "user");
  const builtinDirectory = path.join(builtinRoot, "calendar");
  const userDirectory = path.join(userRoot, "github");
  await writeManifest(builtinDirectory, manifest("com.example.calendar", "./bin/calendar"));
  await writeManifest(userDirectory, manifest("com.example.github", "./bin/github"));

  const plugins = await discoverPlugins({
    hostVersion: "1.4.0",
    builtinDirectories: [builtinRoot],
    userDirectories: [userRoot],
  });

  assert.deepEqual(
    plugins.map((plugin) => ({ id: plugin.id, source: plugin.source, state: plugin.state })),
    [
      { id: "com.example.calendar", source: "builtin", state: "disabled" },
      { id: "com.example.github", source: "user", state: "disabled" },
    ],
  );
  assert.equal(plugins[0].hostApiCompatible, true);
  assert.equal(plugins[0].resolvedEntry?.entryPath, path.join(plugins[0].directory, "bin/calendar"));
});

test("retains invalid and incompatible plugin records without activating them", async () => {
  const root = await temporaryDirectory();
  const invalidDirectory = path.join(root, "invalid");
  const incompatibleDirectory = path.join(root, "incompatible");
  await mkdir(invalidDirectory, { recursive: true });
  await writeFile(path.join(invalidDirectory, "manifest.json"), "{\"schemaVersion\":1}");
  await writeManifest(incompatibleDirectory, manifest("com.example.future", "./bin/future", "^2.0.0"));

  const plugins = await discoverPlugins({
    hostVersion: "1.0.0",
    directories: [
      { path: invalidDirectory, source: "user" },
      { path: incompatibleDirectory, source: "builtin" },
    ],
  });

  const invalid = plugins.find((plugin) => path.basename(plugin.directory) === "invalid");
  assert.equal(invalid?.state, "invalid");
  assert.match(invalid?.validationError ?? "", /id/);
  const incompatible = plugins.find((plugin) => plugin.id === "com.example.future");
  assert.equal(incompatible?.state, "incompatible");
  assert.equal(incompatible?.hostApiCompatible, false);
});

test("checks common Host API semver ranges", () => {
  assert.equal(isHostApiCompatible("1.4.2", "^1.0.0"), true);
  assert.equal(isHostApiCompatible("2.0.0", "^1.0.0"), false);
  assert.equal(isHostApiCompatible("1.2.9", "~1.2.0"), true);
  assert.equal(isHostApiCompatible("1.3.0", "~1.2.0"), false);
  assert.equal(isHostApiCompatible("1.5.0", ">=1.0.0 <2.0.0"), true);
  assert.equal(isHostApiCompatible("1.5.0", "1.x"), true);
  assert.equal(isHostApiCompatible("not-semver", "*"), false);
});

test("keeps process entry paths inside their plugin directory", () => {
  const pluginDirectory = path.join(os.tmpdir(), "queuest-plugin");
  assert.equal(
    resolvePluginEntryPath(pluginDirectory, "./bin/plugin"),
    path.join(pluginDirectory, "bin/plugin"),
  );
  assert.throws(
    () => resolvePluginEntryPath(pluginDirectory, "../outside"),
    /플러그인 디렉터리 밖/,
  );
  assert.throws(
    () => resolvePluginEntryPath(pluginDirectory, path.resolve(pluginDirectory, "outside")),
    /상대 경로/,
  );
});

test("tracks activation state in a reversible, non-destructive JSON store", async () => {
  const root = await temporaryDirectory();
  const pluginDirectory = path.join(root, "plugins", "calendar");
  const statePath = path.join(root, "state", "plugins.json");
  await writeManifest(pluginDirectory, manifest("com.example.calendar", "./bin/calendar"));
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      schemaVersion: 0,
      preserved: { keep: true },
      plugins: { "com.example.calendar": { enabled: false, custom: "keep" } },
    }),
    "utf8",
  );

  const manager = new PluginManager({
    hostVersion: "1.0.0",
    directories: [{ path: pluginDirectory, source: "user" }],
    statePath,
  });
  const discovered = await manager.discover();
  assert.equal(discovered[0].state, "disabled");
  await manager.enablePlugin("com.example.calendar");
  const enabled = manager.getPlugin("com.example.calendar");
  assert.equal(enabled?.installed, true);
  assert.equal(enabled?.enabled, true);
  assert.equal(enabled?.state, "enabled");

  const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
    preserved: unknown;
    plugins: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(persisted.preserved, { keep: true });
  assert.equal(persisted.plugins["com.example.calendar"].custom, "keep");
  assert.equal(persisted.plugins["com.example.calendar"].enabled, true);

  await manager.uninstallPlugin("com.example.calendar");
  assert.equal(manager.getPlugin("com.example.calendar")?.state, "not-installed");
  assert.equal(await fileExists(pluginDirectory), true);
});

test("enables, initializes, requests, and gracefully shuts down an external plugin", async () => {
  const root = await temporaryDirectory();
  const pluginDirectory = path.join(root, "calendar");
  await writeManifest(pluginDirectory, manifest("com.example.calendar", "node"));
  const spawn = fakeSpawn((request, process) => {
    process.respond({ protocolVersion: 1, id: request.id, result: request.method === "initialize" ? {} : { ok: true } });
  });
  const manager = new PluginManager({
    hostVersion: "1.0.0",
    directories: [{ path: pluginDirectory, source: "builtin" }],
    stateStore: new MemoryPluginStateStore(),
    spawnProcess: spawn,
  });

  const transport = await manager.activatePlugin("com.example.calendar");
  assert.equal(transport.status, "running");
  const result = await manager.requestPlugin<{ ok: boolean }>("com.example.calendar", "health.check", {});
  assert.deepEqual(result, { ok: true });
  await manager.shutdown();
  assert.equal(transport.status, "stopped");
  assert.equal(manager.getTransport("com.example.calendar"), undefined);
});

test("correlates out-of-order responses and ignores unmatched responses", async () => {
  const events: string[] = [];
  let process: FakePluginProcess | undefined;
  const spawn = fakeSpawn((request, child) => {
    if (request.id === "one") {
      child.respond({ protocolVersion: 1, id: "unknown", result: "ignored" });
      setImmediate(() => child.respond({ protocolVersion: 1, id: "two", result: "second" }));
      setImmediate(() => child.respond({ protocolVersion: 1, id: "one", result: "first" }));
    } else if (request.method === "shutdown") {
      child.respond({ protocolVersion: 1, id: request.id, result: {} });
    }
  }, (created) => {
    process = created;
  });
  const transport = new PluginTransport({
    command: "plugin",
    cwd: "/tmp/plugin",
    spawnProcess: spawn,
    requestId: (() => {
      const ids = ["one", "two"];
      return () => ids.shift() ?? "fallback";
    })(),
    onEvent: (event) => {
      if (event.type === "unmatched-response") {
        events.push(event.id);
      }
    },
    logger: { warn: () => undefined },
  });

  const first = transport.request("health.check", {});
  const second = transport.request("health.check", {});
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(events, ["unknown"]);
  await transport.shutdown();
  assert.equal(process?.killed, false);
});

test("rejects malformed responses, request timeouts, and process exits", async () => {
  let mode: "malformed" | "timeout" | "exit" = "malformed";
  const spawn = fakeSpawn((request, child) => {
    if (mode === "malformed") {
      child.respondRaw(`{\"protocolVersion\":1,\"id\":\"${request.id}\"}`);
    } else if (mode === "exit") {
      child.emit("exit", 3, null);
    }
  });
  const transport = new PluginTransport({
    command: "plugin",
    cwd: "/tmp/plugin",
    spawnProcess: spawn,
    timeoutMs: 20,
    logger: { warn: () => undefined },
  });

  await assert.rejects(transport.request("health.check", {}), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "MALFORMED_RESPONSE";
  });
  mode = "timeout";
  await assert.rejects(transport.request("health.check", {}), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "REQUEST_TIMEOUT";
  });
  mode = "exit";
  await assert.rejects(transport.request("health.check", {}), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "PROCESS_EXITED";
  });
  await transport.shutdown();
});

test("logs plugin stderr and surfaces plugin error responses", async () => {
  const warnings: string[] = [];
  const spawn = fakeSpawn((request, child) => {
    child.stderr.write("plugin diagnostic\n");
    child.respond({
      protocolVersion: 1,
      id: request.id,
      error: { code: "PLUGIN_ERROR", message: "provider unavailable" },
    });
  });
  const transport = new PluginTransport({
    command: "plugin",
    cwd: "/tmp/plugin",
    spawnProcess: spawn,
    logger: { warn: (message) => warnings.push(message) },
  });

  await assert.rejects(transport.request("health.check", {}), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "PLUGIN_ERROR";
  });
  assert.equal(warnings.some((message) => message.includes("plugin diagnostic")), true);
  await transport.shutdown();
});

test("rejects activation for an incompatible Host API", async () => {
  const root = await temporaryDirectory();
  const pluginDirectory = path.join(root, "future");
  await writeManifest(pluginDirectory, manifest("com.example.future", "node", "^2.0.0"));
  const manager = new PluginManager({
    hostVersion: "1.0.0",
    directories: [{ path: pluginDirectory, source: "user" }],
    stateStore: new MemoryPluginStateStore(),
    spawnProcess: (() => {
      throw new Error("must not spawn incompatible plugin");
    }) as PluginSpawn,
  });

  await assert.rejects(manager.activatePlugin("com.example.future"), (error: unknown) => {
    return error instanceof PluginManagerError && error.code === "HOST_API_INCOMPATIBLE";
  });
});

async function temporaryDirectory(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "queuest-plugin-manager-"));
  temporaryDirectories.push(created);
  return created;
}

async function writeManifest(
  directory: string,
  pluginManifest: PluginManifest,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(pluginManifest)}\n`, "utf8");
}

function manifest(
  id: string,
  command: string,
  hostApi = "^1.0.0",
): PluginManifest {
  return {
    schemaVersion: 1,
    id,
    name: id,
    version: "1.0.0",
    hostApi,
    entry: { type: "process", command },
    capabilities: ["source.work-items"],
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface FakeRequest {
  id: string;
  method: string;
  params: JsonObject;
}

class FakePluginProcess extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public killed = false;
  private readonly onRequest: (request: FakeRequest, process: FakePluginProcess) => void;
  private inputBuffer = "";

  public constructor(onRequest: (request: FakeRequest, process: FakePluginProcess) => void) {
    super();
    this.onRequest = onRequest;
    this.stdin.on("data", (chunk: Buffer) => {
      this.inputBuffer += chunk.toString();
      const lines = this.inputBuffer.split("\n");
      this.inputBuffer = lines.pop() ?? "";
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

  public respondRaw(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  public kill(): boolean {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

function fakeSpawn(
  onRequest: (request: FakeRequest, process: FakePluginProcess) => void,
  onCreate?: (process: FakePluginProcess) => void,
): PluginSpawn {
  return (() => {
    const process = new FakePluginProcess(onRequest);
    onCreate?.(process);
    return process as unknown as PluginProcess;
  }) as PluginSpawn;
}
