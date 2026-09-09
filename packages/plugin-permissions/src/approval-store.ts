import type { PluginPermissions } from "@queuest/plugin-contracts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isEmptyPermissions, normalizePermissions } from "./permissions.ts";

export const PLUGIN_PERMISSION_APPROVAL_SCHEMA_VERSION = 1 as const;
export const PERMISSION_APPROVAL_SCHEMA_VERSION = PLUGIN_PERMISSION_APPROVAL_SCHEMA_VERSION;

export type PermissionApprovalMap = Record<string, PluginPermissions>;

export interface PermissionApprovalStore {
  load(): Promise<PermissionApprovalMap>;
  save(approvals: PermissionApprovalMap): Promise<void>;
}

export class MemoryPermissionApprovalStore implements PermissionApprovalStore {
  private approvals: PermissionApprovalMap;

  public constructor(initial: PermissionApprovalMap = {}) {
    this.approvals = cloneApprovals(initial);
  }

  public async load(): Promise<PermissionApprovalMap> {
    return cloneApprovals(this.approvals);
  }

  public async save(approvals: PermissionApprovalMap): Promise<void> {
    this.approvals = cloneApprovals(approvals);
  }

  public async loadApprovals(): Promise<PermissionApprovalMap> {
    return this.load();
  }

  public async saveApprovals(approvals: PermissionApprovalMap): Promise<void> {
    return this.save(approvals);
  }
}

export interface JsonPermissionApprovalStoreOptions {
  filePath: string;
}

/**
 * Persists grants by replacing a temporary JSON document with rename(2). The
 * store updates only its known permission fields and retains unknown top-level,
 * plugin-level, and nested permission fields from an existing document.
 */
export class JsonPermissionApprovalStore implements PermissionApprovalStore {
  public readonly filePath: string;

  public constructor(filePath: string);
  public constructor(options: JsonPermissionApprovalStoreOptions);
  public constructor(filePathOrOptions: string | JsonPermissionApprovalStoreOptions) {
    const filePath = typeof filePathOrOptions === "string"
      ? filePathOrOptions
      : filePathOrOptions.filePath;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new TypeError("permission approval store filePath must not be empty");
    }
    this.filePath = filePath;
  }

  public async load(): Promise<PermissionApprovalMap> {
    const document = await this.readDocument();
    const source = permissionEntries(document);
    const approvals: PermissionApprovalMap = {};

    for (const [pluginId, value] of Object.entries(source)) {
      if (!isRecord(value)) {
        continue;
      }
      const nestedPermissions = isRecord(value.permissions) ? value.permissions : {};
      approvals[pluginId] = normalizePermissions({
        ...nestedPermissions,
        ...value,
      } as PluginPermissions);
    }

    return cloneApprovals(approvals);
  }

  public async save(approvals: PermissionApprovalMap): Promise<void> {
    const existing = await this.readDocument();
    const existingPlugins = isRecord(existing.plugins) ? existing.plugins : {};
    const normalizedApprovals = cloneApprovals(approvals);
    const nextPlugins: Record<string, unknown> = {};

    for (const [pluginId, value] of Object.entries(existingPlugins)) {
      if (!isRecord(value)) {
        nextPlugins[pluginId] = value;
        continue;
      }
      if (!(pluginId in normalizedApprovals)) {
        nextPlugins[pluginId] = removeKnownPermissionFields(value);
      }
    }

    for (const [pluginId, permissions] of Object.entries(normalizedApprovals)) {
      const previous = isRecord(existingPlugins[pluginId]) ? existingPlugins[pluginId] : {};
      const nextPlugin = removeDirectPermissionFields(previous);
      const previousNested = isRecord(previous.permissions) ? previous.permissions : {};
      const unknownNested = omitKnownPermissionFields(previousNested);
      nextPlugins[pluginId] = {
        ...nextPlugin,
        ...permissions,
        ...(Object.keys(unknownNested).length > 0 ? { permissions: unknownNested } : {}),
      };
    }

    const nextDocument: Record<string, unknown> = {
      ...existing,
      schemaVersion: PLUGIN_PERMISSION_APPROVAL_SCHEMA_VERSION,
      plugins: nextPlugins,
    };
    const parentDirectory = path.dirname(this.filePath);
    await mkdir(parentDirectory, { recursive: true });

    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  public async loadApprovals(): Promise<PermissionApprovalMap> {
    return this.load();
  }

  public async saveApprovals(approvals: PermissionApprovalMap): Promise<void> {
    return this.save(approvals);
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
      throw new Error(`permission approval file is not valid JSON: ${this.filePath}`, {
        cause: error,
      });
    }
    if (!isRecord(parsed)) {
      throw new Error(`permission approval file must be a JSON object: ${this.filePath}`);
    }
    return parsed;
  }
}

export const AtomicJsonPermissionApprovalStore = JsonPermissionApprovalStore;
export const AtomicJsonApprovalStore = JsonPermissionApprovalStore;

function permissionEntries(document: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(document.plugins)) {
    return document.plugins;
  }
  if (isRecord(document.approvals)) {
    return document.approvals;
  }
  return {};
}

function cloneApprovals(approvals: PermissionApprovalMap): PermissionApprovalMap {
  return Object.fromEntries(
    Object.entries(approvals).map(([pluginId, permissions]) => [
      pluginId,
      normalizePermissions(permissions),
    ]).filter(([, permissions]) => !isEmptyPermissions(permissions as PluginPermissions)),
  );
}

function removeKnownPermissionFields(value: Record<string, unknown>): Record<string, unknown> {
  const next = removeDirectPermissionFields(value);
  if (isRecord(value.permissions)) {
    const unknownNested = omitKnownPermissionFields(value.permissions);
    if (Object.keys(unknownNested).length > 0) {
      next.permissions = unknownNested;
    } else {
      delete next.permissions;
    }
  }
  return next;
}

function removeDirectPermissionFields(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  delete next.network;
  delete next.secrets;
  delete next.filesystem;
  return next;
}

function omitKnownPermissionFields(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  delete next.network;
  delete next.secrets;
  delete next.filesystem;
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
