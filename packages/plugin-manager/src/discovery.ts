import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  parsePluginManifest,
  type PluginManifest,
  type PluginProcessEntry,
} from "@queuest/plugin-contracts";

export type PluginSource = "builtin" | "user";

export interface PluginDirectorySpec {
  path: string;
  source: PluginSource;
}

export interface PluginDiscoveryOptions {
  hostVersion: string;
  /** Roots whose immediate child directories contain built-in plugins. */
  builtinDirectories?: readonly string[];
  /** Alias retained for callers that spell built-in as two words. */
  builtInDirectories?: readonly string[];
  /** Roots whose immediate child directories contain user-installed plugins. */
  userDirectories?: readonly string[];
  /** Alias for hosts that use the more explicit name. */
  userPluginDirectories?: readonly string[];
  /** Explicit package directories, useful for app bundles and tests. */
  directories?: readonly PluginDirectorySpec[];
}

export type PluginRecordState =
  | "invalid"
  | "incompatible"
  | "not-installed"
  | "disabled"
  | "enabled";

export interface ResolvedPluginEntry {
  command: string;
  args: string[];
  cwd: string;
  /** Absolute path when the manifest command is a path, otherwise undefined. */
  entryPath?: string;
}

export interface PluginRecord {
  /** Undefined when the manifest could not be parsed far enough to identify it. */
  id?: string;
  source: PluginSource;
  directory: string;
  manifestPath: string;
  manifest?: PluginManifest;
  resolvedEntry?: ResolvedPluginEntry;
  hostApiCompatible: boolean;
  installed: boolean;
  enabled: boolean;
  state: PluginRecordState;
  validationError?: string;
}

/**
 * Discover package directories and validate each manifest independently. One
 * broken plugin must not hide valid built-in or user plugins from the host.
 */
export async function discoverPlugins(options: PluginDiscoveryOptions): Promise<PluginRecord[]> {
  const specs = [
    ...(options.directories ?? []),
    ...toSpecs(
      [...(options.builtinDirectories ?? []), ...(options.builtInDirectories ?? [])],
      "builtin",
    ),
    ...toSpecs(
      [...(options.userDirectories ?? []), ...(options.userPluginDirectories ?? [])],
      "user",
    ),
  ];
  const seen = new Set<string>();
  const records: PluginRecord[] = [];

  for (const spec of specs) {
    const candidates = await discoverSpec(spec);
    for (const candidate of candidates) {
      const key = `${spec.source}:${candidate}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      records.push(await readPluginRecord(candidate, spec.source, options.hostVersion));
    }
  }

  return records.sort((left, right) => {
    const sourceOrder = sourceRank(left.source) - sourceRank(right.source);
    return sourceOrder || left.directory.localeCompare(right.directory);
  });
}

/**
 * Resolve a path-like process command beneath its plugin directory. Bare
 * executable names such as `node` are intentionally left to PATH resolution;
 * manifest paths (the normal `./bin/plugin` form) can never escape the package.
 */
export function resolvePluginEntryPath(pluginDirectory: string, command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("플러그인 entry.command는 비어 있지 않아야 합니다.");
  }
  if (isAbsoluteAnyPlatform(trimmed)) {
    throw new Error("플러그인 entry.command는 플러그인 디렉터리 기준 상대 경로여야 합니다.");
  }

  const root = path.resolve(pluginDirectory);
  const normalizedCommand = trimmed.replaceAll("\\", path.sep);
  const resolved = path.resolve(root, normalizedCommand);
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("플러그인 entry.command가 플러그인 디렉터리 밖을 가리킵니다.");
  }

  return resolved;
}

/** Reject an existing symlinked entry whose target leaves the plugin package. */
export async function assertPluginEntryPathSafe(
  pluginDirectory: string,
  entryPath: string,
): Promise<void> {
  const root = await canonicalPath(pluginDirectory);
  let target: string;
  try {
    target = await realpath(entryPath);
  } catch (error: unknown) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return;
    }
    throw error;
  }

  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("플러그인 entry.command가 심볼릭 링크를 통해 디렉터리 밖을 가리킵니다.");
  }
}

export function resolvePluginEntry(
  pluginDirectory: string,
  entry: PluginProcessEntry,
): ResolvedPluginEntry {
  const command = entry.command.trim();
  const args = entry.args ? [...entry.args] : [];
  const pathLike = isPathLikeCommand(command);
  if (!pathLike) {
    if (!command) {
      throw new Error("플러그인 entry.command는 비어 있지 않아야 합니다.");
    }
    return { command, args, cwd: path.resolve(pluginDirectory) };
  }

  const entryPath = resolvePluginEntryPath(pluginDirectory, command);
  return {
    command: entryPath,
    args,
    cwd: path.resolve(pluginDirectory),
    entryPath,
  };
}

export function applyPluginActivationState(
  record: PluginRecord,
  state: { installed: boolean; enabled: boolean },
): PluginRecord {
  const installed = Boolean(record.manifest) && state.installed;
  const usable =
    Boolean(record.manifest) &&
    record.hostApiCompatible &&
    Boolean(record.resolvedEntry) &&
    record.state !== "invalid";
  const enabled = usable && installed && state.enabled;
  const nextState: PluginRecordState = !record.manifest
    ? "invalid"
    : !record.hostApiCompatible
      ? "incompatible"
      : !installed
        ? "not-installed"
        : enabled
          ? "enabled"
          : "disabled";

  return {
    ...record,
    installed,
    enabled,
    state: nextState,
  };
}

export function isHostApiCompatible(hostVersion: string, hostApiRange: string): boolean {
  const host = parseVersion(hostVersion);
  if (!host) {
    return false;
  }

  return hostApiRange
    .split("||")
    .map((range) => range.trim())
    .some((range) => satisfiesRange(host, range));
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

async function discoverSpec(spec: PluginDirectorySpec): Promise<string[]> {
  const directory = path.resolve(spec.path);
  if (!(await isDirectory(directory))) {
    return [];
  }

  if (await isFile(path.join(directory, "manifest.json"))) {
    return [await canonicalPath(directory)];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    if (await isFile(path.join(candidate, "manifest.json"))) {
      candidates.push(await canonicalPath(candidate));
    }
  }
  return candidates;
}

async function readPluginRecord(
  directory: string,
  source: PluginSource,
  hostVersion: string,
): Promise<PluginRecord> {
  const manifestPath = path.join(directory, "manifest.json");
  const base: PluginRecord = {
    source,
    directory,
    manifestPath,
    hostApiCompatible: false,
    installed: false,
    enabled: false,
    state: "invalid",
  };

  let contents: string;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error: unknown) {
    return { ...base, validationError: readableError(error, "manifest.json을 읽지 못했습니다.") };
  }

  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch (error: unknown) {
    return { ...base, validationError: readableError(error, "manifest.json이 유효한 JSON이 아닙니다.") };
  }

  let manifest: PluginManifest;
  try {
    // Keep all schema and capability validation in the shared contract parser.
    manifest = parsePluginManifest(input);
  } catch (error: unknown) {
    const possibleId = readManifestId(input);
    return {
      ...base,
      ...(possibleId ? { id: possibleId } : {}),
      validationError: readableError(error, "플러그인 manifest 검증에 실패했습니다."),
    };
  }

  const hostApiCompatible = isHostApiCompatible(hostVersion, manifest.hostApi);
  if (!hostApiCompatible) {
    return {
      ...base,
      id: manifest.id,
      manifest,
      hostApiCompatible: false,
      installed: true,
      state: "incompatible",
      validationError: `플러그인이 현재 Host API ${hostVersion}와 호환되지 않습니다: ${manifest.hostApi}`,
    };
  }

  try {
    const resolvedEntry = resolvePluginEntry(directory, manifest.entry);
    if (resolvedEntry.entryPath) {
      await assertPluginEntryPathSafe(directory, resolvedEntry.entryPath);
    }
    return {
      ...base,
      id: manifest.id,
      manifest,
      resolvedEntry,
      hostApiCompatible: true,
      installed: true,
      state: "disabled",
    };
  } catch (error: unknown) {
    return {
      ...base,
      id: manifest.id,
      manifest,
      hostApiCompatible: true,
      installed: true,
      state: "invalid",
      validationError: readableError(error, "플러그인 entry 검증에 실패했습니다."),
    };
  }
}

function satisfiesRange(version: ParsedVersion, range: string): boolean {
  const normalized = range.trim();
  if (!normalized || normalized === "*" || normalized.toLowerCase() === "latest") {
    return true;
  }

  const tokens = normalized.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => satisfiesComparator(version, token));
}

function satisfiesComparator(version: ParsedVersion, token: string): boolean {
  const caretOrTilde = token.match(/^([~^])\s*(.*)$/);
  if (caretOrTilde) {
    const parsed = parseVersion(caretOrTilde[2]);
    if (!parsed) {
      return false;
    }
    const lower = compareVersions(version, parsed) >= 0;
    const upper = caretOrTilde[1] === "^" ? caretUpperBound(parsed) : tildeUpperBound(parsed);
    return lower && compareVersions(version, upper) < 0;
  }

  const comparator = token.match(/^(<=|>=|<|>|=)?\s*(.*)$/);
  if (!comparator) {
    return false;
  }
  const operator = comparator[1] ?? "=";
  const value = comparator[2];
  const wildcard = parseWildcard(value);
  if (wildcard) {
    if (operator !== "=") {
      return false;
    }
    return wildcard.every((part, index) => part === undefined || part === [version.major, version.minor, version.patch][index]);
  }

  const parsed = parseVersion(value);
  if (!parsed) {
    return false;
  }
  const comparison = compareVersions(version, parsed);
  switch (operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    default:
      return comparison === 0;
  }
}

function parseVersion(value: string): ParsedVersion | undefined {
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

function parseWildcard(value: string): [number | undefined, number | undefined, number | undefined] | undefined {
  const pieces = value.trim().replace(/^v/, "").split(".");
  if (pieces.length > 3 || !pieces.length) {
    return undefined;
  }
  if (!pieces.some((piece) => /^(?:x|X|\*)$/.test(piece)) && pieces.length === 3) {
    return undefined;
  }
  if (!pieces.every((piece) => /^(?:\d+|x|X|\*)$/.test(piece))) {
    return undefined;
  }
  const normalized = pieces.map((piece) => (/^(?:x|X|\*)$/.test(piece) ? undefined : Number(piece))) as [
    number | undefined,
    number | undefined,
    number | undefined,
  ];
  while (normalized.length < 3) {
    normalized.push(undefined);
  }
  return normalized;
}

function caretUpperBound(version: ParsedVersion): ParsedVersion {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0 };
  }
  return { major: 0, minor: 0, patch: version.patch + 1 };
}

function tildeUpperBound(version: ParsedVersion): ParsedVersion {
  return { major: version.major, minor: version.minor + 1, patch: 0 };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function toSpecs(paths: readonly string[], source: PluginSource): PluginDirectorySpec[] {
  return paths.map((directory) => ({ path: directory, source }));
}

function sourceRank(source: PluginSource): number {
  return source === "builtin" ? 0 : 1;
}

function isPathLikeCommand(command: string): boolean {
  return command.startsWith(".") || command.includes("/") || command.includes("\\");
}

function isAbsoluteAnyPlatform(value: string): boolean {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isDirectory();
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isFile(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isFile();
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

function readManifestId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return undefined;
  }
  return value.id;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
