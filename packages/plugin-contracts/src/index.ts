export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export const PLUGIN_CAPABILITIES = [
  "source.work-items",
  "source.calendar-events",
  "agent.runner",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface PluginProcessEntry {
  type: "process";
  command: string;
  args?: string[];
}

export interface PluginFilesystemPermission {
  path: string;
  access: "read" | "write";
}

export interface PluginPermissions {
  network?: string[];
  secrets?: string[];
  filesystem?: PluginFilesystemPermission[];
}

export interface PluginManifest {
  schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  hostApi: string;
  entry: PluginProcessEntry;
  capabilities: PluginCapability[];
  permissions?: PluginPermissions;
  configSchema?: JsonObject;
}

export type ConnectionState = "connected" | "disconnected" | "needs-auth" | "error";

export interface ConnectionStatus {
  state: ConnectionState;
  message?: string;
  accountLabel?: string;
}

export interface ExternalWorkItem {
  providerId: string;
  connectionId: string;
  externalId: string;
  externalRef: string;
  sourceUrl: string;
  title: string;
  body: string;
  status: "open" | "in_progress" | "closed";
  updatedAt?: string;
  labels?: string[];
}

export interface ExternalCalendarEvent {
  providerId: string;
  connectionId: string;
  externalId: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  sourceUrl?: string;
  updatedAt?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface WorkItemQuery {
  connectionId: string;
  repository?: string;
  projectKey?: string;
  cursor?: string;
}

export interface CalendarQuery {
  connectionId: string;
  calendarIds: string[];
  startsAt: string;
  endsAt: string;
  cursor?: string;
}

export interface PluginHostInfo {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  appId: "com.yoonhogo.queuest";
  appVersion: string;
}

export interface PluginInitializeParams {
  host: PluginHostInfo;
  grantedPermissions: PluginPermissions;
}

export type PluginMethod =
  | "initialize"
  | "health.check"
  | "connection.status"
  | "source.work-items.list"
  | "source.calendar-events.list"
  | "shutdown";

export interface PluginRequest {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  id: string;
  method: PluginMethod;
  params: JsonObject;
}

export interface PluginSuccessResponse {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  id: string;
  result: JsonValue;
}

export interface PluginErrorResponse {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  id: string;
  error: {
    code: string;
    message: string;
    details?: JsonValue;
  };
}

export type PluginResponse = PluginSuccessResponse | PluginErrorResponse;

export function isPluginCapability(value: unknown): value is PluginCapability {
  return typeof value === "string" && (PLUGIN_CAPABILITIES as readonly string[]).includes(value);
}

export function parsePluginManifest(input: unknown): PluginManifest {
  if (!isRecord(input)) {
    throw new Error("플러그인 manifest는 객체여야 합니다.");
  }

  if (input.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`지원하지 않는 manifest schemaVersion입니다: ${String(input.schemaVersion)}`);
  }

  const id = requiredString(input, "id");
  const name = requiredString(input, "name");
  const version = requiredString(input, "version");
  const hostApi = requiredString(input, "hostApi");

  if (!isRecord(input.entry) || input.entry.type !== "process") {
    throw new Error("플러그인 entry.type은 process여야 합니다.");
  }

  const command = requiredString(input.entry, "command");
  const args = input.entry.args;
  if (args !== undefined && !isStringArray(args)) {
    throw new Error("플러그인 entry.args는 문자열 배열이어야 합니다.");
  }

  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    throw new Error("플러그인은 하나 이상의 capability를 선언해야 합니다.");
  }

  const capabilities = input.capabilities.map((capability) => {
    if (!isPluginCapability(capability)) {
      throw new Error(`지원하지 않는 plugin capability입니다: ${String(capability)}`);
    }
    return capability;
  });

  const permissions = parsePermissions(input.permissions);
  const configSchema = input.configSchema;
  if (configSchema !== undefined && !isJsonObject(configSchema)) {
    throw new Error("plugin configSchema는 JSON 객체여야 합니다.");
  }

  return {
    schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    id,
    name,
    version,
    hostApi,
    entry: {
      type: "process",
      command,
      ...(args ? { args: [...args] } : {}),
    },
    capabilities: [...new Set(capabilities)],
    ...(permissions ? { permissions } : {}),
    ...(configSchema ? { configSchema } : {}),
  };
}

export function parsePluginRequest(input: unknown): PluginRequest {
  if (!isRecord(input)) {
    throw new Error("플러그인 요청은 객체여야 합니다.");
  }

  if (input.protocolVersion !== PLUGIN_PROTOCOL_VERSION) {
    throw new Error(`지원하지 않는 plugin protocolVersion입니다: ${String(input.protocolVersion)}`);
  }

  const id = requiredString(input, "id");
  const method = input.method;
  if (!isPluginMethod(method)) {
    throw new Error(`지원하지 않는 plugin method입니다: ${String(method)}`);
  }

  if (!isJsonObject(input.params)) {
    throw new Error("플러그인 요청 params는 JSON 객체여야 합니다.");
  }

  return {
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    id,
    method,
    params: input.params,
  };
}

function parsePermissions(value: unknown): PluginPermissions | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("plugin permissions는 JSON 객체여야 합니다.");
  }

  const network = parseStringArray(value.network, "permissions.network");
  const secrets = parseStringArray(value.secrets, "permissions.secrets");
  const filesystem = value.filesystem;
  if (filesystem !== undefined && !isFilesystemPermissionArray(filesystem)) {
    throw new Error("permissions.filesystem은 유효한 path/access 객체 배열이어야 합니다.");
  }

  return {
    ...(network ? { network } : {}),
    ...(secrets ? { secrets } : {}),
    ...(filesystem ? { filesystem: filesystem.map((permission) => ({ ...permission })) } : {}),
  };
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isStringArray(value) || !value.every((item) => item.length > 0)) {
    throw new Error(`${field}는 비어 있지 않은 문자열 배열이어야 합니다.`);
  }

  return [...value];
}

function isFilesystemPermission(value: unknown): value is PluginFilesystemPermission {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    (value.access === "read" || value.access === "write")
  );
}

function isFilesystemPermissionArray(value: unknown): value is PluginFilesystemPermission[] {
  return Array.isArray(value) && value.every(isFilesystemPermission);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonObject(value);
}

function isPluginMethod(value: unknown): value is PluginMethod {
  return (
    value === "initialize" ||
    value === "health.check" ||
    value === "connection.status" ||
    value === "source.work-items.list" ||
    value === "source.calendar-events.list" ||
    value === "shutdown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field}는 비어 있지 않은 문자열이어야 합니다.`);
  }

  return value;
}
