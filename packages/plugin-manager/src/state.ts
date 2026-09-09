import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLUGIN_STATE_SCHEMA_VERSION = 1 as const;

export interface PluginActivationState {
  installed: boolean;
  enabled: boolean;
}

export type PluginStateMap = Record<string, PluginActivationState>;

export interface PluginStateStore {
  load(): Promise<PluginStateMap>;
  save(states: PluginStateMap): Promise<void>;
}

/**
 * An in-memory store is useful for the desktop host until its app-data path is
 * available, and makes the manager straightforward to embed in tests.
 */
export class MemoryPluginStateStore implements PluginStateStore {
  private states: PluginStateMap;

  public constructor(initial: PluginStateMap = {}) {
    this.states = cloneStates(initial);
  }

  public async load(): Promise<PluginStateMap> {
    return cloneStates(this.states);
  }

  public async save(states: PluginStateMap): Promise<void> {
    this.states = cloneStates(states);
  }
}

/**
 * Stores only activation metadata. A save merges into the existing document,
 * retaining unknown top-level and per-plugin fields so adding this store does
 * not perform a destructive migration of an older state file.
 */
export class JsonPluginStateStore implements PluginStateStore {
  public readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async load(): Promise<PluginStateMap> {
    const document = await this.readDocument();
    return readStates(document);
  }

  public async save(states: PluginStateMap): Promise<void> {
    const existing = await this.readDocument();
    const plugins = isRecord(existing.plugins) ? { ...existing.plugins } : {};

    for (const [id, state] of Object.entries(states)) {
      const previous = isRecord(plugins[id]) ? plugins[id] : {};
      plugins[id] = {
        ...previous,
        installed: state.installed,
        enabled: state.enabled,
      };
    }

    const nextDocument: Record<string, unknown> = {
      ...existing,
      schemaVersion: PLUGIN_STATE_SCHEMA_VERSION,
      plugins,
    };
    const parentDirectory = path.dirname(this.filePath);
    await mkdir(parentDirectory, { recursive: true });

    // Write then rename so a host crash cannot leave a partially-written state
    // document. The old plugin directories and old state keys are never removed.
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }

  private async readDocument(): Promise<Record<string, unknown>> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error: unknown) {
      throw new Error(`플러그인 상태 파일이 유효한 JSON이 아닙니다: ${this.filePath}`, {
        cause: error,
      });
    }

    if (!isRecord(parsed)) {
      throw new Error(`플러그인 상태 파일은 JSON 객체여야 합니다: ${this.filePath}`);
    }

    return parsed;
  }
}

function readStates(document: Record<string, unknown>): PluginStateMap {
  const source = isRecord(document.plugins) ? document.plugins : document;
  const states: PluginStateMap = {};

  for (const [id, value] of Object.entries(source)) {
    if (!isRecord(value)) {
      continue;
    }

    // The installed default is intentionally true for a discovered directory;
    // older state documents may have persisted only `enabled`.
    const installed = value.installed === undefined ? true : value.installed;
    const enabled = value.enabled === undefined ? false : value.enabled;
    if (typeof installed === "boolean" && typeof enabled === "boolean") {
      states[id] = { installed, enabled };
    }
  }

  return states;
}

function cloneStates(states: PluginStateMap): PluginStateMap {
  return Object.fromEntries(
    Object.entries(states).map(([id, state]) => [id, { ...state }]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
