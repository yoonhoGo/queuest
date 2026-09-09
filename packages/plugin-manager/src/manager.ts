import {
  assertPluginEntryPathSafe,
  discoverPlugins,
  applyPluginActivationState,
  type PluginDiscoveryOptions,
  type PluginRecord,
} from "./discovery.ts";
import {
  JsonPluginStateStore,
  MemoryPluginStateStore,
  type PluginActivationState,
  type PluginStateMap,
  type PluginStateStore,
} from "./state.ts";
import {
  PluginTransport,
  type PluginLogger,
  type PluginRequestOptions,
  type PluginSpawn,
  type PluginTransportOptions,
} from "./transport.ts";
import {
  PermissionBroker,
  PermissionBrokerError,
  type PluginPermissionState,
} from "@queuest/plugin-permissions";
import { PLUGIN_PROTOCOL_VERSION } from "@queuest/plugin-contracts";
import type {
  JsonObject,
  JsonValue,
  PluginMethod,
  PluginPermissions,
} from "@queuest/plugin-contracts";

export interface PluginManagerOptions extends PluginDiscoveryOptions {
  /** Persistent state is optional; hosts can provide app-data statePath. */
  statePath?: string;
  /** Alias for hosts that name the file explicitly. */
  stateFilePath?: string;
  stateStore?: PluginStateStore;
  spawnProcess?: PluginSpawn;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  logger?: PluginLogger;
  permissionBroker?: PermissionBroker;
  grantedPermissions?: PluginPermissions;
  initializeOnActivate?: boolean;
}

export const PLUGIN_PERMISSION_APPROVAL_REQUIRED = "PLUGIN_PERMISSION_APPROVAL_REQUIRED" as const;

export class PluginManagerError extends Error {
  public readonly code: string;
  public readonly pluginId?: string;

  public constructor(
    code: string,
    message: string,
    pluginId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.pluginId = pluginId;
    this.name = "PluginManagerError";
  }
}

export class PluginPermissionApprovalError extends PluginManagerError {
  public readonly permissionState: PluginPermissionState;
  public readonly state: PluginPermissionState;

  public constructor(
    pluginId: string,
    permissionState: PluginPermissionState,
    cause?: unknown,
  ) {
    super(
      PLUGIN_PERMISSION_APPROVAL_REQUIRED,
      "플러그인 권한 승인이 필요합니다.",
      pluginId,
      cause === undefined ? undefined : { cause },
    );
    this.permissionState = permissionState;
    this.state = permissionState;
    this.name = "PluginPermissionApprovalError";
  }
}

/**
 * Owns plugin discovery, activation metadata, and one transport per active
 * plugin. Installation here means recording lifecycle state; it deliberately
 * does not copy, move, or delete plugin directories.
 */
export class PluginManager {
  private readonly discoveryOptions: PluginDiscoveryOptions;
  private readonly stateStore: PluginStateStore;
  private readonly spawnProcess?: PluginSpawn;
  private readonly requestTimeoutMs?: number;
  private readonly shutdownTimeoutMs?: number;
  private readonly logger?: PluginLogger;
  private readonly permissionBroker: PermissionBroker;
  private readonly grantedPermissions: PluginPermissions;
  private readonly initializeOnActivate: boolean;
  private allRecords: PluginRecord[] = [];
  private records = new Map<string, PluginRecord>();
  private states: PluginStateMap = {};
  private transports = new Map<string, PluginTransport>();
  private discovered = false;

  public constructor(options: PluginManagerOptions) {
    this.discoveryOptions = {
      hostVersion: options.hostVersion,
      ...(options.builtinDirectories ? { builtinDirectories: options.builtinDirectories } : {}),
      ...(options.builtInDirectories ? { builtInDirectories: options.builtInDirectories } : {}),
      ...(options.userDirectories ? { userDirectories: options.userDirectories } : {}),
      ...(options.userPluginDirectories
        ? { userPluginDirectories: options.userPluginDirectories }
        : {}),
      ...(options.directories ? { directories: options.directories } : {}),
    };
    this.stateStore =
      options.stateStore ??
      (options.statePath || options.stateFilePath
        ? new JsonPluginStateStore(options.statePath ?? options.stateFilePath ?? "")
        : new MemoryPluginStateStore());
    this.spawnProcess = options.spawnProcess;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs;
    this.logger = options.logger;
    this.permissionBroker = options.permissionBroker ?? new PermissionBroker();
    this.grantedPermissions = clonePermissions(options.grantedPermissions ?? {});
    this.initializeOnActivate = options.initializeOnActivate ?? true;
  }

  public async discover(): Promise<PluginRecord[]> {
    this.states = await this.stateStore.load();
    const discovered = await discoverPlugins(this.discoveryOptions);
    this.allRecords = discovered.map((record) => this.withPersistedState(record));
    this.records = selectPreferredRecords(this.allRecords);
    this.discovered = true;
    return this.listPlugins();
  }

  public async refresh(): Promise<PluginRecord[]> {
    return this.discover();
  }

  /** Returns one record per id, with user plugins shadowing built-ins. */
  public listPlugins(): PluginRecord[] {
    return [...this.records.values()].map(cloneRecord);
  }

  /** Returns every discovered package, including duplicate ids. */
  public listAllPlugins(): PluginRecord[] {
    return this.allRecords.map(cloneRecord);
  }

  public getPlugin(id: string): PluginRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  /** Mark a discovered package installed without mutating its directory. */
  public async installPlugin(id: string): Promise<PluginRecord> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    await this.updateState(id, {
      installed: true,
      enabled: record.enabled,
    });
    return this.requireRecordSync(id);
  }

  public async enablePlugin(id: string): Promise<PluginRecord> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    if (!record.installed) {
      throw new PluginManagerError(
        "PLUGIN_NOT_INSTALLED",
        "플러그인이 설치 상태가 아닙니다.",
        id,
      );
    }
    await this.updateState(id, { installed: true, enabled: true });
    return this.requireRecordSync(id);
  }

  public async disablePlugin(id: string): Promise<PluginRecord> {
    const record = await this.requireRecord(id);
    await this.deactivatePlugin(id);
    await this.updateState(id, { installed: record.installed, enabled: false });
    return this.requireRecordSync(id);
  }

  /**
   * Marks a package not installed but leaves its state entry and files in
   * place. This gives the host a reversible uninstall toggle.
   */
  public async uninstallPlugin(id: string): Promise<PluginRecord> {
    await this.requireRecord(id);
    await this.deactivatePlugin(id);
    await this.updateState(id, { installed: false, enabled: false });
    return this.requireRecordSync(id);
  }

  /** Inspect the current manifest request and persisted approval state. */
  public async inspectPluginPermissions(id: string): Promise<PluginPermissionState> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    return this.permissionBroker.inspect(id, record.manifest?.permissions);
  }

  /** Persist an explicitly selected subset of the manifest request. */
  public async approvePluginPermissions(
    id: string,
    selected: PluginPermissions,
  ): Promise<PluginPermissionState> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    return this.permissionBroker.approve(id, record.manifest?.permissions ?? {}, selected);
  }

  public async revokePluginPermissions(
    id: string,
    selected?: PluginPermissions,
  ): Promise<PluginPermissionState> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    return this.permissionBroker.revoke(id, selected);
  }

  public async getApprovedPluginPermissions(id: string): Promise<PluginPermissions> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    return this.permissionBroker.getApprovedPermissions(id, record.manifest?.permissions);
  }

  /** Enable and spawn a process plugin. A later app shutdown preserves enabled state. */
  public async activatePlugin(id: string): Promise<PluginTransport> {
    const record = await this.requireRecord(id);
    this.assertValid(record);
    if (!record.installed) {
      throw new PluginManagerError(
        "PLUGIN_NOT_INSTALLED",
        "플러그인이 설치 상태가 아닙니다.",
        id,
      );
    }
    const approvedPermissions = await this.resolveApprovedPermissions(id, record);
    const existing = this.transports.get(id);
    if (existing && existing.status === "running") {
      return existing;
    }

    const enabledRecord = await this.enablePlugin(id);
    if (!enabledRecord.resolvedEntry) {
      throw new PluginManagerError("PLUGIN_ENTRY_INVALID", "플러그인 entry를 해석하지 못했습니다.", id);
    }
    if (enabledRecord.resolvedEntry.entryPath) {
      try {
        await assertPluginEntryPathSafe(enabledRecord.directory, enabledRecord.resolvedEntry.entryPath);
      } catch (error: unknown) {
        throw new PluginManagerError(
          "PLUGIN_ENTRY_INVALID",
          readableError(error),
          id,
          { cause: error },
        );
      }
    }

    const transportOptions: PluginTransportOptions = {
      ...enabledRecord.resolvedEntry,
      pluginId: id,
      ...(this.requestTimeoutMs === undefined ? {} : { timeoutMs: this.requestTimeoutMs }),
      ...(this.shutdownTimeoutMs === undefined
        ? {}
        : { shutdownTimeoutMs: this.shutdownTimeoutMs }),
      ...(this.spawnProcess ? { spawnProcess: this.spawnProcess } : {}),
      ...(this.logger ? { logger: this.logger } : {}),
    };
    const transport = new PluginTransport(transportOptions);
    try {
      await transport.start();
      if (this.initializeOnActivate) {
        await transport.request("initialize", {
          host: {
            protocolVersion: PLUGIN_PROTOCOL_VERSION,
            appId: "com.yoonhogo.queuest",
            appVersion: this.discoveryOptions.hostVersion,
          },
          // PluginPermissions is contract-typed but intentionally does not
          // carry JsonObject's open index signature; its fields are JSON-safe.
          grantedPermissions: { ...approvedPermissions } as unknown as JsonObject,
        });
      }
    } catch (error: unknown) {
      await transport.shutdown();
      throw error;
    }
    this.transports.set(id, transport);
    return transport;
  }

  public async deactivatePlugin(id: string): Promise<void> {
    const transport = this.transports.get(id);
    if (!transport) {
      return;
    }
    this.transports.delete(id);
    await transport.shutdown();
  }

  public getTransport(id: string): PluginTransport | undefined {
    return this.transports.get(id);
  }

  public async requestPlugin<T extends JsonValue = JsonValue>(
    id: string,
    method: PluginMethod,
    params: JsonObject,
    options: PluginRequestOptions = {},
  ): Promise<T> {
    const transport = this.transports.get(id);
    if (!transport) {
      throw new PluginManagerError("PLUGIN_NOT_ACTIVE", "플러그인이 활성화되지 않았습니다.", id);
    }
    return transport.request<T>(method, params, options);
  }

  /** Gracefully stop active processes while retaining enabled state. */
  public async shutdown(): Promise<void> {
    const active = [...this.transports.entries()];
    this.transports.clear();
    await Promise.allSettled(
      active.map(async ([id, transport]) => {
        try {
          await transport.shutdown();
        } catch (error: unknown) {
          this.logger?.warn?.(`[plugin:${id}] shutdown 실패: ${readableError(error)}`);
        }
      }),
    );
  }

  private async requireRecord(id: string): Promise<PluginRecord> {
    if (!this.discovered) {
      await this.discover();
    }
    return this.requireRecordSync(id);
  }

  private async resolveApprovedPermissions(
    pluginId: string,
    record: PluginRecord,
  ): Promise<PluginPermissions> {
    // Keep the pre-broker initialize payload for the existing public option
    // when a manifest does not declare any permission boundary.
    if (record.manifest?.permissions === undefined) {
      return clonePermissions(this.grantedPermissions);
    }

    try {
      return await this.permissionBroker.requireApproval(pluginId, record.manifest.permissions);
    } catch (error: unknown) {
      if (
        error instanceof PermissionBrokerError &&
        error.code === "PERMISSION_APPROVAL_REQUIRED" &&
        error.state
      ) {
        throw new PluginPermissionApprovalError(pluginId, error.state, error);
      }
      throw error;
    }
  }

  private requireRecordSync(id: string): PluginRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new PluginManagerError("PLUGIN_NOT_FOUND", "플러그인을 찾지 못했습니다.", id);
    }
    return record;
  }

  private assertValid(record: PluginRecord): void {
    if (!record.manifest) {
      throw new PluginManagerError(
        "PLUGIN_INVALID",
        record.validationError ?? "플러그인 manifest 또는 entry가 유효하지 않습니다.",
        record.id,
      );
    }
    if (!record.hostApiCompatible) {
      throw new PluginManagerError(
        "HOST_API_INCOMPATIBLE",
        record.validationError ?? "플러그인이 현재 Host API와 호환되지 않습니다.",
        record.id,
      );
    }
    if (!record.resolvedEntry || record.state === "invalid") {
      throw new PluginManagerError(
        "PLUGIN_INVALID",
        record.validationError ?? "플러그인 manifest 또는 entry가 유효하지 않습니다.",
        record.id,
      );
    }
  }

  private withPersistedState(record: PluginRecord): PluginRecord {
    const defaultState: PluginActivationState = {
      installed: record.installed,
      enabled: false,
    };
    return applyPluginActivationState(record, record.id ? this.states[record.id] ?? defaultState : defaultState);
  }

  private async updateState(id: string, state: PluginActivationState): Promise<void> {
    const nextStates: PluginStateMap = {
      ...this.states,
      [id]: { ...state },
    };
    await this.stateStore.save(nextStates);
    this.states = nextStates;
    this.allRecords = this.allRecords.map((record) =>
      record.id === id ? applyPluginActivationState(record, state) : record,
    );
    this.records = selectPreferredRecords(this.allRecords);
  }
}

function selectPreferredRecords(records: readonly PluginRecord[]): Map<string, PluginRecord> {
  const selected = new Map<string, PluginRecord>();
  for (const record of records) {
    if (!record.id) {
      continue;
    }
    const previous = selected.get(record.id);
    if (!previous || shouldPrefer(record, previous)) {
      selected.set(record.id, record);
    }
  }
  return selected;
}

function shouldPrefer(candidate: PluginRecord, previous: PluginRecord): boolean {
  if (candidate.source !== previous.source) {
    return candidate.source === "user";
  }
  return candidate.directory < previous.directory;
}

function cloneRecord(record: PluginRecord): PluginRecord {
  return {
    ...record,
    ...(record.manifest
      ? {
          manifest: {
            ...record.manifest,
            entry: {
              ...record.manifest.entry,
              ...(record.manifest.entry.args ? { args: [...record.manifest.entry.args] } : {}),
            },
            capabilities: [...record.manifest.capabilities],
            ...(record.manifest.permissions
              ? { permissions: clonePermissions(record.manifest.permissions) }
              : {}),
          },
        }
      : {}),
    ...(record.resolvedEntry
      ? { resolvedEntry: { ...record.resolvedEntry, args: [...record.resolvedEntry.args] } }
      : {}),
  };
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "알 수 없는 오류";
}

function clonePermissions(permissions: PluginPermissions): PluginPermissions {
  return {
    ...(permissions.platform ? { platform: [...permissions.platform] } : {}),
    ...(permissions.network ? { network: [...permissions.network] } : {}),
    ...(permissions.secrets ? { secrets: [...permissions.secrets] } : {}),
    ...(permissions.filesystem
      ? { filesystem: permissions.filesystem.map((permission) => ({ ...permission })) }
      : {}),
  };
}
