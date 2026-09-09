import { spawn as spawnChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  PLUGIN_PROTOCOL_VERSION,
  type CalendarQuery,
  type ConnectionStatus,
  type ExternalCalendarEvent,
  type ExternalWorkItem,
  type JsonObject,
  type JsonValue,
  type Page,
  type PluginMethod,
  type PluginPermissions,
  type WorkItemQuery,
} from "@queuest/plugin-contracts";
import {
  normalizePermissions,
  type PermissionInput,
} from "@queuest/plugin-permissions";
import {
  PluginProtocolError,
  type PluginHandlers,
} from "@queuest/plugin-sdk";

export const EVENTKIT_CALENDAR_PLATFORM_PERMISSION = "macos.eventkit.calendar" as const;
export const EVENTKIT_REMINDERS_PLATFORM_PERMISSION = "macos.eventkit.reminders" as const;
export const APPLE_CALENDAR_PLATFORM_PERMISSION = EVENTKIT_CALENDAR_PLATFORM_PERMISSION;
export const APPLE_REMINDERS_PLATFORM_PERMISSION = EVENTKIT_REMINDERS_PLATFORM_PERMISSION;

export const EVENTKIT_ERROR_CODES = {
  permissionDenied: "PERMISSION_DENIED",
  invalidInput: "INVALID_INPUT",
  notInitialized: "NOT_INITIALIZED",
  tccNotDetermined: "TCC_NOT_DETERMINED",
  tccDenied: "TCC_DENIED",
  tccRestricted: "TCC_RESTRICTED",
  tccReadAccessRequired: "TCC_READ_ACCESS_REQUIRED",
  tccRequestFailed: "TCC_REQUEST_FAILED",
  eventKitReadFailed: "EVENTKIT_READ_FAILED",
  malformedResponse: "MALFORMED_RESPONSE",
  nativeProcessUnavailable: "NATIVE_PROCESS_UNAVAILABLE",
  nativeProcessError: "NATIVE_PROCESS_ERROR",
  requestTimeout: "REQUEST_TIMEOUT",
  invalidProtocol: "INVALID_PROTOCOL",
  capabilityUnsupported: "CAPABILITY_UNSUPPORTED",
  eventKit: "EVENTKIT_ERROR",
} as const;

export type EventKitPluginErrorCode =
  (typeof EVENTKIT_ERROR_CODES)[keyof typeof EVENTKIT_ERROR_CODES] | string;

/** Safe, typed errors that are allowed to cross the outer plugin protocol. */
export class EventKitPluginError extends PluginProtocolError {
  public readonly status?: number;

  public constructor(
    code: EventKitPluginErrorCode,
    message: string,
    options?: { status?: number; details?: JsonValue },
  ) {
    super(code, message, options?.details);
    this.status = options?.status;
    this.name = "EventKitPluginError";
  }
}

export type EventKitResource = "calendar" | "reminders";

export interface EventKitProcess {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type EventKitSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] },
) => EventKitProcess;

export interface EventKitNativeClientOptions {
  resource: EventKitResource;
  binaryPath?: string;
  cwd?: string;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  spawnProcess?: EventKitSpawn;
  spawn?: EventKitSpawn;
  requestId?: () => string;
}

export interface EventKitNativeClientLike {
  initialize(params: JsonObject): Promise<unknown>;
  healthCheck(): Promise<ConnectionStatus>;
  connectionStatus(connectionId: string): Promise<ConnectionStatus>;
  tccStatus(): Promise<JsonObject>;
  requestTccAccess(): Promise<JsonObject>;
  listCalendarEvents(query: CalendarQuery): Promise<Page<ExternalCalendarEvent>>;
  listWorkItems(query: WorkItemQuery): Promise<Page<ExternalWorkItem>>;
  shutdown(): Promise<void>;
}

/**
 * JSONL client for the shared Swift EventKit process. The process receives the
 * same versioned Queuest protocol as any other plugin, which keeps the TCC
 * boundary below the JavaScript handler and makes the native source directly
 * testable with stdin/stdout fixtures.
 */
export class EventKitNativeClient implements EventKitNativeClientLike {
  private readonly resource: EventKitResource;
  private readonly binaryPath: string;
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly spawnProcess: EventKitSpawn;
  private readonly requestId: () => string;
  private readonly pending = new Map<string, PendingRequest>();
  private process?: EventKitProcess;
  private reader?: Interface;
  private status: "idle" | "running" | "stopping" | "stopped" | "failed" = "idle";
  private terminationPromise?: Promise<void>;

  public constructor(options: EventKitNativeClientOptions) {
    this.resource = options.resource;
    this.binaryPath = options.binaryPath ?? defaultBinaryPath();
    this.cwd = options.cwd ?? dirname(this.binaryPath);
    this.timeoutMs = positiveDuration(options.requestTimeoutMs, 10_000);
    this.shutdownTimeoutMs = positiveDuration(options.shutdownTimeoutMs, 2_000);
    this.spawnProcess = options.spawnProcess ?? options.spawn ?? defaultSpawn;
    this.requestId = options.requestId ?? defaultRequestId;
  }

  public async initialize(params: JsonObject): Promise<unknown> {
    return this.request("initialize", params);
  }

  public async healthCheck(): Promise<ConnectionStatus> {
    try {
      return parseConnectionStatus(await this.request("health.check", {}));
    } catch (error: unknown) {
      return connectionStatusForError(error, this.resource);
    }
  }

  public async connectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      return parseConnectionStatus(await this.request("connection.status", { connectionId }));
    } catch (error: unknown) {
      return connectionStatusForError(error, this.resource);
    }
  }

  public async tccStatus(): Promise<JsonObject> {
    return parseJsonObject(
      await this.request("tcc.status", {}),
      EVENTKIT_ERROR_CODES.malformedResponse,
      this.resource,
    );
  }

  public async getTccStatus(): Promise<JsonObject> {
    return this.tccStatus();
  }

  public async requestTccAccess(): Promise<JsonObject> {
    return parseJsonObject(
      await this.request("tcc.request-access", {}),
      EVENTKIT_ERROR_CODES.malformedResponse,
      this.resource,
    );
  }

  public async requestAccess(): Promise<JsonObject> {
    return this.requestTccAccess();
  }

  public async listCalendarEvents(query: CalendarQuery): Promise<Page<ExternalCalendarEvent>> {
    return parseCalendarPage(
      await this.request("source.calendar-events.list", query as unknown as JsonObject),
      this.resource,
    );
  }

  public async listWorkItems(query: WorkItemQuery): Promise<Page<ExternalWorkItem>> {
    return parseWorkItemPage(
      await this.request("source.work-items.list", query as unknown as JsonObject),
      this.resource,
    );
  }

  public get processHandle(): EventKitProcess | undefined {
    return this.process;
  }

  public get processStatus(): "idle" | "running" | "stopping" | "stopped" | "failed" {
    return this.status;
  }

  public get executablePath(): string {
    return this.binaryPath;
  }

  public async listEvents(query: CalendarQuery): Promise<Page<ExternalCalendarEvent>> {
    return this.listCalendarEvents(query);
  }

  public async eventsList(query: CalendarQuery): Promise<Page<ExternalCalendarEvent>> {
    return this.listCalendarEvents(query);
  }

  public async listReminders(query: WorkItemQuery): Promise<Page<ExternalWorkItem>> {
    return this.listWorkItems(query);
  }

  public async shutdown(): Promise<void> {
    const process = this.process;
    if (!process) {
      return;
    }
    try {
      await this.request("shutdown", {});
    } catch {
      // The child may already have exited; closing its streams below is safe.
    }
    this.status = "stopping";
    this.reader?.close();
    process.stdin?.end();
    await this.waitForTermination(this.shutdownTimeoutMs);
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // Ignore a process that exited between the wait and kill.
      }
    }
    this.process = undefined;
    this.status = "stopped";
  }

  private async request(method: PluginMethod, params: JsonObject): Promise<unknown> {
    await this.start();
    const process = this.process;
    if (!process?.stdin) {
      throw nativeError(EVENTKIT_ERROR_CODES.nativeProcessError, this.resource);
    }
    const id = this.requestId();
    const payload = JSON.stringify({
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      id,
      method,
      params,
    });

    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(nativeError(EVENTKIT_ERROR_CODES.requestTimeout, this.resource));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timeout });
      try {
        process.stdin?.write(`${payload}\n`);
      } catch {
        clearTimeout(timeout);
        this.pending.delete(id);
        rejectPromise(nativeError(EVENTKIT_ERROR_CODES.nativeProcessError, this.resource));
      }
    });
  }

  private async start(): Promise<void> {
    if (this.status === "running") {
      return;
    }
    if (this.status !== "idle") {
      throw nativeError(EVENTKIT_ERROR_CODES.nativeProcessError, this.resource);
    }

    let child: EventKitProcess;
    try {
      child = this.spawnProcess(this.binaryPath, ["--resource", this.resource], {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      this.status = "failed";
      throw nativeError(EVENTKIT_ERROR_CODES.nativeProcessUnavailable, this.resource);
    }
    if (!child.stdin || !child.stdout) {
      this.status = "failed";
      try {
        child.kill();
      } catch {
        // Ignore a malformed process handle.
      }
      throw nativeError(EVENTKIT_ERROR_CODES.nativeProcessError, this.resource);
    }

    this.process = child;
    this.status = "running";
    this.terminationPromise = new Promise<void>((resolvePromise) => {
      child.once("exit", () => {
        this.status = "stopped";
        this.rejectPending(nativeError(EVENTKIT_ERROR_CODES.nativeProcessError, this.resource));
        resolvePromise();
      });
      child.once("close", () => resolvePromise());
    });
    child.on("error", () => {
      this.status = "failed";
      this.rejectPending(nativeError(EVENTKIT_ERROR_CODES.nativeProcessError, this.resource));
    });
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.rejectPending(nativeError(EVENTKIT_ERROR_CODES.invalidProtocol, this.resource));
      return;
    }
    if (!isRecord(value) || value.protocolVersion !== PLUGIN_PROTOCOL_VERSION || typeof value.id !== "string") {
      this.rejectPending(nativeError(EVENTKIT_ERROR_CODES.invalidProtocol, this.resource));
      return;
    }
    const pending = this.pending.get(value.id);
    if (!pending) {
      return;
    }
    this.pending.delete(value.id);
    clearTimeout(pending.timeout);
    if (isRecord(value.error)) {
      const code = typeof value.error.code === "string"
        ? value.error.code
        : EVENTKIT_ERROR_CODES.eventKit;
      pending.reject(nativeError(code, this.resource));
      return;
    }
    if (!("result" in value) || !isJsonValue(value.result)) {
      pending.reject(nativeError(EVENTKIT_ERROR_CODES.malformedResponse, this.resource));
      return;
    }
    pending.resolve(value.result);
  }

  private rejectPending(error: EventKitPluginError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private async waitForTermination(timeoutMs: number): Promise<void> {
    if (!this.terminationPromise) {
      return;
    }
    await Promise.race([
      this.terminationPromise,
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, timeoutMs)),
    ]);
  }
}

export interface EventKitPluginHandlersOptions {
  resource: EventKitResource;
  client?: EventKitNativeClientLike;
  nativeClient?: EventKitNativeClientLike;
  native?: Omit<EventKitNativeClientOptions, "resource">;
  requiredPlatformPermission?: string;
}

/** Creates read-only handlers for one EventKit entity type. */
export function createEventKitPluginHandlers(
  options: EventKitPluginHandlersOptions,
): PluginHandlers {
  const requiredPermission = options.requiredPlatformPermission ?? requiredPlatformPermission(options.resource);
  const client = options.nativeClient ?? options.client ?? new EventKitNativeClient({
    resource: options.resource,
    ...(options.native ?? {}),
  });
  let initialized = false;

  return {
    initialize: async (params) => {
      const granted = parseGrantedPermissions(params.grantedPermissions, options.resource, requiredPermission);
      const initializedResult = await client.initialize({
        ...params,
        grantedPermissions: permissionsAsJson(granted),
      });
      initialized = true;
      return initializedResult ?? { initialized: true };
    },
    healthCheck: async () => {
      if (!initialized) {
        return {
          state: "error",
          message: `${displayName(options.resource)} 플러그인이 초기화되지 않았습니다.`,
        };
      }
      return client.healthCheck();
    },
    connectionStatus: async (params) => {
      ensureInitialized(initialized, options.resource);
      return client.connectionStatus(requireConnectionId(params.connectionId, options.resource));
    },
    tccStatus: async () => {
      ensureInitialized(initialized, options.resource);
      return client.tccStatus();
    },
    requestTccAccess: async () => {
      ensureInitialized(initialized, options.resource);
      return client.requestTccAccess();
    },
    listCalendarEvents: async (params) => {
      ensureInitialized(initialized, options.resource);
      if (options.resource !== "calendar") {
        throw new EventKitPluginError(
          EVENTKIT_ERROR_CODES.capabilityUnsupported,
          "Apple Reminders 플러그인은 일정 capability를 구현하지 않습니다.",
        );
      }
      return client.listCalendarEvents(parseCalendarQuery(params));
    },
    listWorkItems: async (params) => {
      ensureInitialized(initialized, options.resource);
      if (options.resource !== "reminders") {
        throw new EventKitPluginError(
          EVENTKIT_ERROR_CODES.capabilityUnsupported,
          "Apple Calendar 플러그인은 작업 항목 capability를 구현하지 않습니다.",
        );
      }
      return client.listWorkItems(parseWorkItemQuery(params));
    },
    shutdown: async () => {
      initialized = false;
      await client.shutdown();
      return { shutdown: true };
    },
  };
}

export function parseGrantedPermissions(
  value: unknown,
  resource: EventKitResource,
  requiredPermission = requiredPlatformPermission(resource),
): PluginPermissions {
  let permissions: PluginPermissions;
  try {
    permissions = normalizePermissions(value as PermissionInput);
  } catch {
    throw new EventKitPluginError(
      EVENTKIT_ERROR_CODES.permissionDenied,
      `${displayName(resource)} 플러그인 권한이 유효하지 않습니다.`,
    );
  }
  if (!(permissions.platform ?? []).some((value) =>
    platformPermissionMatches(value, resource, requiredPermission),
  )) {
    throw new EventKitPluginError(
      EVENTKIT_ERROR_CODES.permissionDenied,
      `${displayName(resource)} 플러그인의 macOS 권한 승인이 필요합니다.`,
    );
  }
  return permissions;
}

export function parseCalendarQuery(value: unknown): CalendarQuery {
  const record = asInputRecord(value, "Apple Calendar 일정 조회 파라미터가 유효하지 않습니다.");
  const connectionId = requireConnectionId(record.connectionId, "calendar");
  const rawCalendarIds = record.calendarIds ?? (record.calendarId === undefined ? undefined : [record.calendarId]);
  if (!Array.isArray(rawCalendarIds) || rawCalendarIds.length === 0 || rawCalendarIds.length > 100) {
    throw invalidInput("Apple Calendar calendarIds가 유효하지 않습니다.");
  }
  const calendarIds = rawCalendarIds.map((value) => requireBoundedString(value, "calendarId", 512, "calendar"));
  if (new Set(calendarIds).size !== calendarIds.length) {
    throw invalidInput("Apple Calendar calendarIds에 중복 항목이 있습니다.");
  }
  const startsAt = requireRfc3339(record.startsAt ?? record.timeMin, "startsAt", "calendar");
  const endsAt = requireRfc3339(record.endsAt ?? record.timeMax, "endsAt", "calendar");
  if (Date.parse(startsAt) > Date.parse(endsAt)) {
    throw invalidInput("Apple Calendar 시간 범위가 유효하지 않습니다.");
  }
  const cursor = parseCursor(record.cursor, "calendar");
  return {
    connectionId,
    calendarIds,
    startsAt,
    endsAt,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function parseWorkItemQuery(value: unknown): WorkItemQuery {
  const record = asInputRecord(value, "Apple Reminders 작업 항목 조회 파라미터가 유효하지 않습니다.");
  const connectionId = requireConnectionId(record.connectionId, "reminders");
  const repository = record.repository === undefined
    ? undefined
    : requireBoundedString(record.repository, "repository", 512, "reminders");
  const projectKey = record.projectKey === undefined
    ? undefined
    : requireBoundedString(record.projectKey, "projectKey", 512, "reminders");
  const cursor = parseCursor(record.cursor, "reminders");
  return {
    connectionId,
    ...(repository === undefined ? {} : { repository }),
    ...(projectKey === undefined ? {} : { projectKey }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export const parseCalendarEventQuery = parseCalendarQuery;
export const parseAppleCalendarQuery = parseCalendarQuery;
export const parseReminderQuery = parseWorkItemQuery;
export const parseAppleReminderQuery = parseWorkItemQuery;

function parseCalendarPage(value: unknown, resource: EventKitResource): Page<ExternalCalendarEvent> {
  const page = parsePage(value, resource);
  const items = page.items.map((item) => parseCalendarEvent(item, resource));
  return page.nextCursor === undefined ? { items } : { items, nextCursor: page.nextCursor };
}

function parseWorkItemPage(value: unknown, resource: EventKitResource): Page<ExternalWorkItem> {
  const page = parsePage(value, resource);
  const items = page.items.map((item) => parseWorkItem(item, resource));
  return page.nextCursor === undefined ? { items } : { items, nextCursor: page.nextCursor };
}

function parsePage(value: unknown, resource: EventKitResource): { items: unknown[]; nextCursor?: string } {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw nativeError(EVENTKIT_ERROR_CODES.malformedResponse, resource);
  }
  const nextCursor = value.nextCursor;
  if (nextCursor !== undefined && (typeof nextCursor !== "string" || !/^\d{1,12}$/.test(nextCursor))) {
    throw nativeError(EVENTKIT_ERROR_CODES.malformedResponse, resource);
  }
  return {
    items: value.items,
    ...(typeof nextCursor === "string" ? { nextCursor } : {}),
  };
}

function parseCalendarEvent(value: unknown, resource: EventKitResource): ExternalCalendarEvent {
  if (!isRecord(value) ||
      typeof value.providerId !== "string" ||
      typeof value.connectionId !== "string" ||
      typeof value.externalId !== "string" ||
      typeof value.calendarId !== "string" ||
      typeof value.title !== "string" ||
      typeof value.startsAt !== "string" ||
      typeof value.endsAt !== "string" ||
      typeof value.allDay !== "boolean" ||
      !isCalendarStatus(value.status)) {
    throw nativeError(EVENTKIT_ERROR_CODES.malformedResponse, resource);
  }
  return {
    providerId: value.providerId,
    connectionId: value.connectionId,
    externalId: value.externalId,
    calendarId: value.calendarId,
    title: value.title,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    allDay: value.allDay,
    status: value.status,
    ...(optionalString(value.sourceUrl) === undefined ? {} : { sourceUrl: optionalString(value.sourceUrl) }),
    ...(optionalString(value.updatedAt) === undefined ? {} : { updatedAt: optionalString(value.updatedAt) }),
  };
}

function parseWorkItem(value: unknown, resource: EventKitResource): ExternalWorkItem {
  if (!isRecord(value) ||
      typeof value.providerId !== "string" ||
      typeof value.connectionId !== "string" ||
      typeof value.externalId !== "string" ||
      typeof value.externalRef !== "string" ||
      typeof value.sourceUrl !== "string" ||
      typeof value.title !== "string" ||
      typeof value.body !== "string" ||
      !isWorkItemStatus(value.status)) {
    throw nativeError(EVENTKIT_ERROR_CODES.malformedResponse, resource);
  }
  const labels = value.labels;
  if (labels !== undefined && (!Array.isArray(labels) || !labels.every((label) => typeof label === "string"))) {
    throw nativeError(EVENTKIT_ERROR_CODES.malformedResponse, resource);
  }
  return {
    providerId: value.providerId,
    connectionId: value.connectionId,
    externalId: value.externalId,
    externalRef: value.externalRef,
    sourceUrl: value.sourceUrl,
    title: value.title,
    body: value.body,
    status: value.status,
    ...(optionalString(value.updatedAt) === undefined ? {} : { updatedAt: optionalString(value.updatedAt) }),
    ...(labels === undefined ? {} : { labels: labels as string[] }),
  };
}

function parseConnectionStatus(value: unknown): ConnectionStatus {
  if (!isRecord(value) || !isConnectionState(value.state)) {
    throw nativeError(EVENTKIT_ERROR_CODES.malformedResponse, "calendar");
  }
  return {
    state: value.state,
    ...(optionalString(value.message) === undefined ? {} : { message: optionalString(value.message) }),
    ...(optionalString(value.accountLabel) === undefined ? {} : { accountLabel: optionalString(value.accountLabel) }),
  };
}

function connectionStatusForError(error: unknown, resource: EventKitResource): ConnectionStatus {
  if (error instanceof EventKitPluginError) {
    switch (error.code) {
      case EVENTKIT_ERROR_CODES.tccNotDetermined:
      case EVENTKIT_ERROR_CODES.tccDenied:
        return { state: "needs-auth", message: error.message };
      case EVENTKIT_ERROR_CODES.tccRestricted:
      case EVENTKIT_ERROR_CODES.tccReadAccessRequired:
      case EVENTKIT_ERROR_CODES.permissionDenied:
      case EVENTKIT_ERROR_CODES.notInitialized:
        return { state: "error", message: error.message };
      default:
        return { state: "error", message: error.message || `${displayName(resource)} 연결 상태를 확인하지 못했습니다.` };
    }
  }
  return { state: "error", message: `${displayName(resource)} 연결 상태를 확인하지 못했습니다.` };
}

function permissionsAsJson(value: PluginPermissions): JsonObject {
  return value as unknown as JsonObject;
}

function ensureInitialized(initialized: boolean, resource: EventKitResource): void {
  if (!initialized) {
    throw new EventKitPluginError(
      EVENTKIT_ERROR_CODES.notInitialized,
      `${displayName(resource)} 플러그인이 초기화되지 않았습니다.`,
    );
  }
}

function requiredPlatformPermission(resource: EventKitResource): string {
  return resource === "calendar"
    ? EVENTKIT_CALENDAR_PLATFORM_PERMISSION
    : EVENTKIT_REMINDERS_PLATFORM_PERMISSION;
}

function platformPermissionMatches(
  value: string,
  resource: EventKitResource,
  requiredPermission: string,
): boolean {
  const normalized = value.trim().toLowerCase();
  const required = requiredPermission.trim().toLowerCase();
  if (normalized === required) {
    return true;
  }
  return resource === "calendar"
    ? normalized === EVENTKIT_CALENDAR_PLATFORM_PERMISSION || normalized === "eventkit.calendar" || normalized === "macos.calendar"
    : normalized === EVENTKIT_REMINDERS_PLATFORM_PERMISSION || normalized === "eventkit.reminders" || normalized === "macos.reminders";
}

function displayName(resource: EventKitResource): string {
  return resource === "calendar" ? "Apple Calendar" : "Apple Reminders";
}

function requireConnectionId(value: unknown, resource: EventKitResource): string {
  return requireBoundedString(value, "connectionId", 256, resource);
}

function requireBoundedString(value: unknown, field: string, maximum: number, resource: EventKitResource): string {
  if (typeof value !== "string") {
    throw invalidInput(`${displayName(resource)} ${field}가 유효하지 않습니다.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw invalidInput(`${displayName(resource)} ${field}가 유효하지 않습니다.`);
  }
  return normalized;
}

function requireRfc3339(value: unknown, field: string, resource: EventKitResource): string {
  const normalized = requireBoundedString(value, field, 128, resource);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw invalidInput(`${displayName(resource)} ${field}가 RFC3339 형식이어야 합니다.`);
  }
  return normalized;
}

function parseCursor(value: unknown, resource: EventKitResource): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) {
    throw invalidInput(`${displayName(resource)} page cursor가 유효하지 않습니다.`);
  }
  return value;
}

function invalidInput(message: string): EventKitPluginError {
  return new EventKitPluginError(EVENTKIT_ERROR_CODES.invalidInput, message);
}

function nativeError(code: string, resource: EventKitResource): EventKitPluginError {
  return new EventKitPluginError(code, safeMessageForCode(code, resource));
}

function safeMessageForCode(code: string, resource: EventKitResource): string {
  const name = displayName(resource);
  switch (code) {
    case EVENTKIT_ERROR_CODES.permissionDenied:
      return `${name} 플러그인의 macOS 권한 승인이 필요합니다.`;
    case EVENTKIT_ERROR_CODES.tccNotDetermined:
      return `${name} 접근 권한 요청이 필요합니다.`;
    case EVENTKIT_ERROR_CODES.tccDenied:
      return `${name} 접근 권한이 거부되었습니다.`;
    case EVENTKIT_ERROR_CODES.tccRestricted:
      return `${name} 접근이 시스템 정책으로 제한되었습니다.`;
    case EVENTKIT_ERROR_CODES.tccReadAccessRequired:
      return `${name} 읽기 권한이 필요합니다.`;
    case EVENTKIT_ERROR_CODES.tccRequestFailed:
      return `${name} 접근 권한 요청에 실패했습니다.`;
    case EVENTKIT_ERROR_CODES.eventKitReadFailed:
      return `${name} 항목을 읽지 못했습니다.`;
    case EVENTKIT_ERROR_CODES.invalidInput:
      return `${name} 입력이 유효하지 않습니다.`;
    case EVENTKIT_ERROR_CODES.notInitialized:
      return `${name} 플러그인이 초기화되지 않았습니다.`;
    case EVENTKIT_ERROR_CODES.requestTimeout:
      return `${name} native process 요청 시간이 초과되었습니다.`;
    case EVENTKIT_ERROR_CODES.nativeProcessUnavailable:
      return `${name} native process를 시작하지 못했습니다.`;
    case EVENTKIT_ERROR_CODES.nativeProcessError:
      return `${name} native process 오류가 발생했습니다.`;
    case EVENTKIT_ERROR_CODES.invalidProtocol:
    case EVENTKIT_ERROR_CODES.malformedResponse:
      return `${name} native process 응답이 유효하지 않습니다.`;
    case EVENTKIT_ERROR_CODES.capabilityUnsupported:
      return `${name} capability가 지원되지 않습니다.`;
    default:
      return `${name} 작업을 완료하지 못했습니다.`;
  }
}

function asInputRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidInput(message);
  }
  return value;
}

function parseJsonObject(value: unknown, code: string, resource: EventKitResource): JsonObject {
  if (!isRecord(value)) {
    throw nativeError(code, resource);
  }
  return value as JsonObject;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isConnectionState(value: unknown): value is ConnectionStatus["state"] {
  return value === "connected" || value === "disconnected" || value === "needs-auth" || value === "error";
}

function isCalendarStatus(value: unknown): value is ExternalCalendarEvent["status"] {
  return value === "confirmed" || value === "tentative" || value === "cancelled";
}

function isWorkItemStatus(value: unknown): value is ExternalWorkItem["status"] {
  return value === "open" || value === "in_progress" || value === "closed";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function defaultBinaryPath(): string {
  const configured = process.env.QUEUEST_EVENTKIT_BINARY;
  if (configured && configured.trim().length > 0) {
    return resolve(configured);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../native/.build/queuest-eventkit");
}

function defaultRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const defaultSpawn: EventKitSpawn = (command, args, options) => {
  return spawnChildProcess(command, [...args], options) as unknown as EventKitProcess;
};

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: EventKitPluginError) => void;
  timeout: ReturnType<typeof setTimeout>;
}
