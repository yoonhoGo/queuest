import type {
  PluginFilesystemPermission,
  PluginPermissions,
} from "@queuest/plugin-contracts";
import path from "node:path";

export type PermissionInput = PluginPermissions | null | undefined;

export interface PluginPermissionState {
  requested: PluginPermissions;
  granted: PluginPermissions;
  missing: PluginPermissions;
}

export type PermissionState = PluginPermissionState;
export type PermissionDiff = PluginPermissionState;

const accessRank: Record<PluginFilesystemPermission["access"], number> = {
  read: 1,
  write: 2,
};

/**
 * Canonicalizes a manifest permission declaration without broadening it.
 * Network host names are case-insensitive; secret names retain their case;
 * filesystem paths are normalized lexically and are never expanded from `~`.
 */
export function normalizePermissions(input: PermissionInput = {}): PluginPermissions {
  if (input === null || input === undefined) {
    return {};
  }

  if (!isRecord(input)) {
    throw new TypeError("plugin permissions must be an object");
  }

  const permissions = input as PluginPermissions;
  const network = normalizeStringList(permissions.network, "network", normalizeNetworkDomain);
  const secrets = normalizeStringList(permissions.secrets, "secrets", normalizeSecretName);
  const filesystem = normalizeFilesystem(permissions.filesystem);

  return {
    ...(network.length > 0 ? { network } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
    ...(filesystem.length > 0 ? { filesystem } : {}),
  };
}

export const normalizePluginPermissions = normalizePermissions;

/**
 * Returns the current request, the part covered by existing grants, and the
 * part still requiring approval. The first argument is the requested set.
 * A broader persisted grant can cover a narrower request, but the effective
 * grant returned here is always shaped like the current request.
 */
export function diffPermissions(
  requested: PermissionInput,
  granted: PermissionInput,
): PluginPermissionState;
export function diffPermissions(input: {
  requested: PermissionInput;
  granted: PermissionInput;
}): PluginPermissionState;
export function diffPermissions(
  requestedOrInput: PermissionInput | { requested: PermissionInput; granted: PermissionInput },
  maybeGranted?: PermissionInput,
): PluginPermissionState {
  const requested = isDiffInput(requestedOrInput)
    ? requestedOrInput.requested
    : requestedOrInput;
  const granted = isDiffInput(requestedOrInput)
    ? requestedOrInput.granted
    : maybeGranted;
  const normalizedRequested = normalizePermissions(requested);
  const normalizedGranted = normalizePermissions(granted);

  return {
    requested: normalizedRequested,
    granted: intersectPermissions(normalizedRequested, normalizedGranted),
    missing: subtractPermissions(normalizedRequested, normalizedGranted),
  };
}

export const diffPluginPermissions = diffPermissions;
export const calculatePermissionDiff = diffPermissions;
export const diffPermissionState = diffPermissions;
export const computePermissionDiff = diffPermissions;

export function permissionState(
  requested: PermissionInput,
  granted: PermissionInput,
): PluginPermissionState {
  return diffPermissions(requested, granted);
}

export function hasMissingPermissions(state: Pick<PluginPermissionState, "missing">): boolean {
  return !isEmptyPermissions(state.missing);
}

export function isEmptyPermissions(input: PermissionInput): boolean {
  const permissions = normalizePermissions(input);
  return (
    (permissions.network?.length ?? 0) === 0 &&
    (permissions.secrets?.length ?? 0) === 0 &&
    (permissions.filesystem?.length ?? 0) === 0
  );
}

/** Returns whether a requested permission is covered by an approved grant. */
export function permissionIsCovered(
  requested: PluginPermissions,
  granted: PluginPermissions,
): boolean {
  return isEmptyPermissions(subtractPermissions(requested, granted));
}

/**
 * Returns whether a selection is no more privileged than the request. This
 * allows a user to approve read-only access for a write-capable request while
 * keeping the write permission missing.
 */
export function isPermissionSubset(
  selection: PermissionInput,
  requested: PermissionInput,
): boolean {
  const normalizedSelection = normalizePermissions(selection);
  const normalizedRequested = normalizePermissions(requested);
  return permissionIsCovered(normalizedSelection, normalizedRequested);
}

export function mergePermissions(
  first: PermissionInput,
  second: PermissionInput,
): PluginPermissions {
  const left = normalizePermissions(first);
  const right = normalizePermissions(second);
  return normalizePermissions({
    network: [...(left.network ?? []), ...(right.network ?? [])],
    secrets: [...(left.secrets ?? []), ...(right.secrets ?? [])],
    filesystem: [...(left.filesystem ?? []), ...(right.filesystem ?? [])],
  });
}

/** Removes approved grants covered by the selected permissions. */
export function subtractGrantedPermissions(
  granted: PermissionInput,
  revoked: PermissionInput,
): PluginPermissions {
  const normalizedGranted = normalizePermissions(granted);
  const normalizedRevoked = normalizePermissions(revoked);

  const network = (normalizedGranted.network ?? []).filter(
    (entry) => !(normalizedRevoked.network ?? []).some((target) => domainCovers(target, entry)),
  );
  const secrets = (normalizedGranted.secrets ?? []).filter(
    (entry) => !(normalizedRevoked.secrets ?? []).includes(entry),
  );
  const filesystem = (normalizedGranted.filesystem ?? []).filter(
    (entry) =>
      !(normalizedRevoked.filesystem ?? []).some((target) =>
        filesystemPermissionCovers(target, entry),
      ),
  );

  return normalizePermissions({ network, secrets, filesystem });
}

function intersectPermissions(
  requested: PluginPermissions,
  granted: PluginPermissions,
): PluginPermissions {
  const network = (requested.network ?? []).filter((entry) =>
    (granted.network ?? []).some((grant) => domainCovers(grant, entry)),
  );
  const secrets = (requested.secrets ?? []).filter((entry) =>
    (granted.secrets ?? []).includes(entry),
  );
  const filesystem = (requested.filesystem ?? []).filter((entry) =>
    (granted.filesystem ?? []).some((grant) => filesystemPermissionCovers(grant, entry)),
  );

  return normalizePermissions({ network, secrets, filesystem });
}

function subtractPermissions(
  requested: PluginPermissions,
  granted: PluginPermissions,
): PluginPermissions {
  const network = (requested.network ?? []).filter(
    (entry) => !(granted.network ?? []).some((grant) => domainCovers(grant, entry)),
  );
  const secrets = (requested.secrets ?? []).filter(
    (entry) => !(granted.secrets ?? []).includes(entry),
  );
  const filesystem = (requested.filesystem ?? []).filter(
    (entry) =>
      !(granted.filesystem ?? []).some((grant) => filesystemPermissionCovers(grant, entry)),
  );

  return normalizePermissions({ network, secrets, filesystem });
}

function normalizeStringList(
  value: string[] | undefined,
  field: string,
  normalize: (value: string) => string,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`plugin permissions.${field} must be an array`);
  }

  return [...new Set(value.map((entry) => {
    if (typeof entry !== "string") {
      throw new TypeError(`plugin permissions.${field} must contain strings`);
    }
    return normalize(entry);
  }))].sort((left, right) => left.localeCompare(right));
}

function normalizeNetworkDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new TypeError("network permission domains must not be empty");
  }
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function normalizeSecretName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError("secret permission names must not be empty");
  }
  return normalized;
}

function normalizeFilesystem(
  value: PluginFilesystemPermission[] | undefined,
): PluginFilesystemPermission[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError("plugin permissions.filesystem must be an array");
  }

  const byPath = new Map<string, PluginFilesystemPermission["access"]>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new TypeError("filesystem permissions must contain path/access objects");
    }
    if (entry.access !== "read" && entry.access !== "write") {
      throw new TypeError("filesystem permission access must be read or write");
    }
    const normalizedPath = normalizeFilesystemPath(entry.path);
    const previous = byPath.get(normalizedPath);
    if (previous === undefined || accessRank[entry.access] > accessRank[previous]) {
      byPath.set(normalizedPath, entry.access);
    }
  }

  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pathValue, access]) => ({ path: pathValue, access }));
}

function normalizeFilesystemPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError("filesystem permission paths must not be empty");
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function domainCovers(grant: string, requested: string): boolean {
  if (grant === requested) {
    return true;
  }

  if (grant.startsWith("*.")) {
    const suffix = grant.slice(1);
    return requested.endsWith(suffix) && requested !== suffix.slice(1);
  }

  return requested.endsWith(`.${grant}`);
}

function filesystemPermissionCovers(
  grant: PluginFilesystemPermission,
  requested: PluginFilesystemPermission,
): boolean {
  return (
    accessRank[grant.access] >= accessRank[requested.access] &&
    filesystemPathCovers(grant.path, requested.path)
  );
}

function filesystemPathCovers(grantPath: string, requestedPath: string): boolean {
  if (grantPath === requestedPath) {
    return true;
  }
  const relative = path.posix.relative(grantPath, requestedPath);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.posix.sep}`) && !path.posix.isAbsolute(relative);
}

function isDiffInput(
  value: PermissionInput | { requested: PermissionInput; granted: PermissionInput },
): value is { requested: PermissionInput; granted: PermissionInput } {
  return isRecord(value) && "requested" in value && "granted" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
