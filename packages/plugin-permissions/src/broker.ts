import type { PluginPermissions } from "@queuest/plugin-contracts";
import {
  diffPermissions,
  isPermissionSubset,
  isEmptyPermissions,
  mergePermissions,
  normalizePermissions,
  subtractGrantedPermissions,
  type PermissionInput,
  type PluginPermissionState,
} from "./permissions.ts";
import {
  MemoryPermissionApprovalStore,
  type PermissionApprovalMap,
  type PermissionApprovalStore,
} from "./approval-store.ts";

export interface PermissionBrokerOptions {
  approvalStore?: PermissionApprovalStore;
  store?: PermissionApprovalStore;
}

export class PermissionBrokerError extends Error {
  public readonly code: string;
  public readonly pluginId?: string;
  public readonly state?: PluginPermissionState;

  public constructor(
    code: string,
    message: string,
    pluginId?: string,
    state?: PluginPermissionState,
  ) {
    super(message);
    this.code = code;
    this.pluginId = pluginId;
    this.state = state;
    this.name = "PermissionBrokerError";
  }
}

/**
 * Coordinates requested permissions with explicit user approvals. Reading a
 * manifest or inspecting state never writes a grant; only approve() persists a
 * selected subset of the current request.
 */
export class PermissionBroker {
  private readonly approvalStore: PermissionApprovalStore;
  private readonly requestedByPlugin = new Map<string, PluginPermissions>();
  private mutation: Promise<void> = Promise.resolve();

  public constructor(options: PermissionBrokerOptions | PermissionApprovalStore = {}) {
    if (isPermissionApprovalStore(options)) {
      this.approvalStore = options;
    } else {
      this.approvalStore = options.approvalStore ?? options.store ?? new MemoryPermissionApprovalStore();
    }
  }

  public async inspect(
    pluginId: string,
    requested: PermissionInput,
  ): Promise<PluginPermissionState> {
    const normalizedRequested = this.rememberRequest(pluginId, requested);
    const approvals = await this.approvalStore.load();
    return diffPermissions(normalizedRequested, approvals[pluginId]);
  }

  public async inspectPermissions(
    pluginId: string,
    requested: PermissionInput,
  ): Promise<PluginPermissionState> {
    return this.inspect(pluginId, requested);
  }

  public async getPermissionState(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissionState> {
    return this.inspect(pluginId, this.resolveRememberedRequest(pluginId, requested));
  }

  public async approve(
    pluginId: string,
    selected: PluginPermissions,
  ): Promise<PluginPermissionState>;
  public async approve(
    pluginId: string,
    requested: PluginPermissions,
    selected: PluginPermissions,
  ): Promise<PluginPermissionState>;
  public async approve(
    pluginId: string,
    requestedOrSelected: PluginPermissions,
    maybeSelected?: PluginPermissions,
  ): Promise<PluginPermissionState> {
    const requested = maybeSelected === undefined
      ? this.resolveRememberedRequest(pluginId)
      : this.rememberRequest(pluginId, requestedOrSelected);
    const selected = normalizePermissions(maybeSelected ?? requestedOrSelected);

    if (maybeSelected === undefined && !this.requestedByPlugin.has(pluginId)) {
      throw new PermissionBrokerError(
        "PERMISSION_REQUEST_REQUIRED",
        "inspect or pass the current permission request before approving a plugin",
        pluginId,
      );
    }
    if (!isPermissionSubset(selected, requested)) {
      throw new PermissionBrokerError(
        "PERMISSION_NOT_REQUESTED",
        "a plugin can only receive a selected subset of its requested permissions",
        pluginId,
      );
    }

    await this.enqueueMutation(async () => {
      const approvals = await this.approvalStore.load();
      approvals[pluginId] = mergePermissions(approvals[pluginId], selected);
      await this.approvalStore.save(approvals);
    });

    return this.inspect(pluginId, requested);
  }

  public async approvePermissions(
    pluginId: string,
    selected: PluginPermissions,
  ): Promise<PluginPermissionState>;
  public async approvePermissions(
    pluginId: string,
    requested: PluginPermissions,
    selected: PluginPermissions,
  ): Promise<PluginPermissionState>;
  public async approvePermissions(
    pluginId: string,
    requestedOrSelected: PluginPermissions,
    maybeSelected?: PluginPermissions,
  ): Promise<PluginPermissionState> {
    return maybeSelected === undefined
      ? this.approve(pluginId, requestedOrSelected)
      : this.approve(pluginId, requestedOrSelected, maybeSelected);
  }

  /** Explicit convenience method; it is never called implicitly by inspect(). */
  public async approveAll(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissionState> {
    const resolved = requested === undefined
      ? this.resolveRememberedRequest(pluginId)
      : this.rememberRequest(pluginId, requested);
    return this.approve(pluginId, resolved, resolved);
  }

  public async revoke(
    pluginId: string,
    selected?: PermissionInput,
  ): Promise<PluginPermissionState> {
    const requested = this.requestedByPlugin.get(pluginId) ?? {};
    await this.enqueueMutation(async () => {
      const approvals = await this.approvalStore.load();
      if (selected === undefined) {
        delete approvals[pluginId];
      } else {
        const remaining = subtractGrantedPermissions(approvals[pluginId], selected);
        if (isEmptyPermissions(remaining)) {
          delete approvals[pluginId];
        } else {
          approvals[pluginId] = remaining;
        }
      }
      await this.approvalStore.save(approvals);
    });
    return this.inspect(pluginId, requested);
  }

  public async revokePermissions(
    pluginId: string,
    selected?: PermissionInput,
  ): Promise<PluginPermissionState> {
    return this.revoke(pluginId, selected);
  }

  /**
   * Throws until every current request is approved and returns only the
   * current request entries covered by persisted grants.
   */
  public async requireApproval(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    const state = await this.getPermissionState(pluginId, requested);
    if (Object.keys(state.missing).length > 0) {
      throw new PermissionBrokerError(
        "PERMISSION_APPROVAL_REQUIRED",
        "plugin permission approval is required before use",
        pluginId,
        state,
      );
    }
    return state.granted;
  }

  public async requireApprovedPermissions(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return this.requireApproval(pluginId, requested);
  }

  public async requirePermissions(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return this.requireApproval(pluginId, requested);
  }

  /** Returns only grants which are approved for the current request. */
  public async getApprovedPermissions(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return (await this.getPermissionState(pluginId, requested)).granted;
  }

  public async getGrantedPermissions(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return this.getApprovedPermissions(pluginId, requested);
  }

  public async exposeApprovedGrants(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return this.getApprovedPermissions(pluginId, requested);
  }

  public async getApprovedGrants(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return this.getApprovedPermissions(pluginId, requested);
  }

  public async exposeApprovedPermissions(
    pluginId: string,
    requested?: PermissionInput,
  ): Promise<PluginPermissions> {
    return this.getApprovedPermissions(pluginId, requested);
  }

  private rememberRequest(pluginId: string, requested: PermissionInput): PluginPermissions {
    assertPluginId(pluginId);
    const normalized = normalizePermissions(requested);
    this.requestedByPlugin.set(pluginId, normalized);
    return normalized;
  }

  private resolveRememberedRequest(
    pluginId: string,
    requested?: PermissionInput,
  ): PluginPermissions {
    if (requested !== undefined) {
      return this.rememberRequest(pluginId, requested);
    }
    assertPluginId(pluginId);
    const remembered = this.requestedByPlugin.get(pluginId);
    if (remembered === undefined) {
      throw new PermissionBrokerError(
        "PERMISSION_REQUEST_REQUIRED",
        "inspect or pass the current permission request before using grants",
        pluginId,
      );
    }
    return remembered;
  }

  private async enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const previous = this.mutation;
    let release: (() => void) | undefined;
    this.mutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await operation();
    } finally {
      release?.();
    }
  }
}

function isPermissionApprovalStore(
  value: PermissionBrokerOptions | PermissionApprovalStore,
): value is PermissionApprovalStore {
  return typeof (value as PermissionApprovalStore).load === "function" && typeof (value as PermissionApprovalStore).save === "function";
}

function assertPluginId(pluginId: string): void {
  if (typeof pluginId !== "string" || pluginId.trim().length === 0) {
    throw new PermissionBrokerError(
      "INVALID_PLUGIN_ID",
      "plugin id must not be empty",
      pluginId,
    );
  }
}

export type { PermissionApprovalMap };
