import {
  PLUGIN_PROTOCOL_VERSION,
  type CalendarQuery,
  type ConnectionStatus,
  type ExternalCalendarEvent,
  type Page,
  type PluginPermissions,
} from "@queuest/plugin-contracts";
import {
  CredentialStoreError,
  MacOSKeychainCredentialStore,
  normalizePermissions,
  type CredentialStore,
} from "@queuest/plugin-permissions";
import type { PluginHandlers } from "@queuest/plugin-sdk";

export const CALENDAR_PLUGIN_ID = "com.queuest.calendar" as const;
export const CALENDAR_PROVIDER_ID = "google-calendar" as const;
export const CALENDAR_API_BASE_URL = "https://www.googleapis.com" as const;
export const CALENDAR_API_BASE = CALENDAR_API_BASE_URL;
export const CALENDAR_NETWORK_PERMISSION = "www.googleapis.com" as const;
export const CALENDAR_SECRET_PERMISSION = "calendar" as const;
export const CALENDAR_EVENTS_PATH = "/calendar/v3/calendars" as const;
export const CALENDAR_PRIMARY_PATH = "/calendar/v3/calendars/primary" as const;
export const CALENDAR_CONNECTION_PATH = CALENDAR_PRIMARY_PATH;
export const CALENDAR_EVENTS_LIST_PATH = CALENDAR_EVENTS_PATH;
export const CALENDAR_PAGE_SIZE = 2500 as const;
export const CALENDAR_MAX_PAGE_TOKEN_LENGTH = 1024 as const;
export const CALENDAR_MAX_NEXT_PAGE_TOKEN_LENGTH = CALENDAR_MAX_PAGE_TOKEN_LENGTH;
export const CALENDAR_MAX_CURSOR_LENGTH = 4096 as const;
export const CALENDAR_API_VERSION = "3" as const;
export const CALENDAR_USER_AGENT = "Queuest Calendar Plugin/0.1.0" as const;
export const CALENDAR_ACCEPT_HEADER = "application/json" as const;
export const CALENDAR_CONTENT_TYPE = "application/json" as const;

// Provider-specific aliases make the Google Calendar identity explicit to
// callers while retaining the shorter names used by the other connectors.
export const GOOGLE_CALENDAR_PLUGIN_ID = CALENDAR_PLUGIN_ID;
export const GOOGLE_CALENDAR_PROVIDER_ID = CALENDAR_PROVIDER_ID;
export const GOOGLE_CALENDAR_API_BASE_URL = CALENDAR_API_BASE_URL;
export const GOOGLE_CALENDAR_API_BASE = CALENDAR_API_BASE_URL;
export const GOOGLE_CALENDAR_NETWORK_PERMISSION = CALENDAR_NETWORK_PERMISSION;
export const GOOGLE_CALENDAR_SECRET_PERMISSION = CALENDAR_SECRET_PERMISSION;
export const GOOGLE_CALENDAR_EVENTS_PATH = CALENDAR_EVENTS_PATH;
export const GOOGLE_CALENDAR_PRIMARY_PATH = CALENDAR_PRIMARY_PATH;
export const GOOGLE_CALENDAR_CONNECTION_PATH = CALENDAR_CONNECTION_PATH;
export const GOOGLE_CALENDAR_EVENTS_LIST_PATH = CALENDAR_EVENTS_LIST_PATH;
export const GOOGLE_CALENDAR_PAGE_SIZE = CALENDAR_PAGE_SIZE;
export const GOOGLE_CALENDAR_MAX_PAGE_TOKEN_LENGTH = CALENDAR_MAX_PAGE_TOKEN_LENGTH;
export const GOOGLE_CALENDAR_MAX_NEXT_PAGE_TOKEN_LENGTH = CALENDAR_MAX_NEXT_PAGE_TOKEN_LENGTH;
export const GOOGLE_CALENDAR_API_VERSION = CALENDAR_API_VERSION;
export const GOOGLE_CALENDAR_USER_AGENT = CALENDAR_USER_AGENT;
export const GOOGLE_CALENDAR_ACCEPT_HEADER = CALENDAR_ACCEPT_HEADER;
export const GOOGLE_CALENDAR_CONTENT_TYPE = CALENDAR_CONTENT_TYPE;

export const CALENDAR_ERROR_CODES = {
  permissionDenied: "PERMISSION_DENIED",
  invalidInput: "INVALID_INPUT",
  credentialNotFound: "CREDENTIAL_NOT_FOUND",
  malformedCredential: "MALFORMED_CREDENTIAL",
  credentialError: "CREDENTIAL_ERROR",
  auth: "AUTH_ERROR",
  notFound: "NOT_FOUND",
  rateLimit: "RATE_LIMITED",
  http: "HTTP_ERROR",
  malformedResponse: "MALFORMED_RESPONSE",
  network: "NETWORK_ERROR",
  notInitialized: "NOT_INITIALIZED",
} as const;

export type CalendarPluginErrorCode = (typeof CALENDAR_ERROR_CODES)[keyof typeof CALENDAR_ERROR_CODES];
export type GoogleCalendarPluginErrorCode = CalendarPluginErrorCode;
export const GOOGLE_CALENDAR_ERROR_CODES = CALENDAR_ERROR_CODES;

/** Safe, provider-specific failures. Messages never contain tokens or API response bodies. */
export class CalendarPluginError extends Error {
  public readonly code: CalendarPluginErrorCode;
  public readonly status?: number;

  public constructor(
    code: CalendarPluginErrorCode,
    message: string,
    options?: { status?: number },
  ) {
    super(message);
    this.code = code;
    this.status = options?.status;
    this.name = "CalendarPluginError";
  }
}

export const GoogleCalendarPluginError = CalendarPluginError;
export const CalendarApiError = CalendarPluginError;
export const GoogleCalendarApiError = CalendarPluginError;

export interface CalendarFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export type GoogleCalendarFetch = CalendarFetch;

export interface CalendarRestClientOptions {
  fetch?: CalendarFetch;
  credentialStore?: CredentialStore;
  grantedPermissions?: PluginPermissions;
  /** Alias useful to callers that name the initialize grant simply permissions. */
  permissions?: PluginPermissions;
}

export type GoogleCalendarRestClientOptions = CalendarRestClientOptions;

export interface CalendarPluginHandlersOptions extends CalendarRestClientOptions {
  client?: CalendarRestClient;
}

export type GoogleCalendarPluginHandlersOptions = CalendarPluginHandlersOptions;

/** The JSON shape stored in CredentialStore for a Google Calendar connection. */
export interface CalendarCredential {
  accessToken: string;
}

export type GoogleCalendarCredential = CalendarCredential;

/** CalendarQuery with provider naming aliases accepted by the process boundary. */
export interface CalendarEventQuery extends CalendarQuery {
  pageToken?: string;
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
}

interface CalendarJsonResponse {
  response: Response;
  body: unknown;
}

interface CalendarEventPage {
  items: ExternalCalendarEvent[];
  nextPageToken?: string;
}

interface CalendarPageCursor {
  version: 1;
  calendarIds: string[];
  tokens: Array<string | undefined>;
  done: boolean[];
}

const MULTI_CURSOR_PREFIX = "calendar:v1:";

/**
 * Small Google Calendar REST client. Its base URL and request paths are fixed;
 * only validated calendar IDs and bounded query values enter request URLs.
 */
export class CalendarRestClient {
  private readonly fetcher: CalendarFetch;
  private readonly credentialStore: CredentialStore;
  private grantedPermissions: PluginPermissions;

  public constructor(options?: CalendarRestClientOptions);
  public constructor(
    fetcher: CalendarFetch,
    credentialStore?: CredentialStore,
    grantedPermissions?: PluginPermissions,
  );
  public constructor(
    optionsOrFetcher: CalendarRestClientOptions | CalendarFetch = {},
    credentialStore?: CredentialStore,
    grantedPermissions?: PluginPermissions,
  ) {
    if (typeof optionsOrFetcher === "function") {
      this.fetcher = optionsOrFetcher;
      this.credentialStore = credentialStore ?? new MacOSKeychainCredentialStore();
      this.grantedPermissions = clonePermissions(grantedPermissions ?? {});
      return;
    }

    this.fetcher = optionsOrFetcher.fetch ?? defaultCalendarFetch;
    this.credentialStore = optionsOrFetcher.credentialStore ?? new MacOSKeychainCredentialStore();
    this.grantedPermissions = clonePermissions(
      optionsOrFetcher.grantedPermissions ?? optionsOrFetcher.permissions ?? {},
    );
  }

  /** Replace the grants delivered by initialize without retaining old grants. */
  public setGrantedPermissions(grantedPermissions: PluginPermissions): void {
    this.grantedPermissions = clonePermissions(grantedPermissions);
  }

  public getGrantedPermissions(): PluginPermissions {
    return clonePermissions(this.grantedPermissions);
  }

  /** Throws before touching either CredentialStore or fetch. */
  public assertApprovedPermissions(): void {
    let normalized: PluginPermissions;
    try {
      normalized = normalizePermissions(this.grantedPermissions);
    } catch {
      throw new CalendarPluginError(
        CALENDAR_ERROR_CODES.permissionDenied,
        "Calendar 플러그인 권한이 유효하지 않습니다.",
      );
    }

    const hasNetworkPermission = normalized.network?.includes(CALENDAR_NETWORK_PERMISSION) ?? false;
    const hasSecretPermission = normalized.secrets?.includes(CALENDAR_SECRET_PERMISSION) ?? false;
    if (!hasNetworkPermission || !hasSecretPermission) {
      throw new CalendarPluginError(
        CALENDAR_ERROR_CODES.permissionDenied,
        "Calendar 플러그인의 API 및 credential 권한 승인이 필요합니다.",
      );
    }
  }

  public async listCalendarEvents(query: CalendarEventQuery): Promise<Page<ExternalCalendarEvent>> {
    // Keep the permission gate ahead of credential retrieval and API construction.
    this.assertApprovedPermissions();
    const normalizedQuery = normalizeCalendarQuery(query);
    const cursor = parseCalendarCursor(normalizedQuery.cursor, normalizedQuery.calendarIds);
    const credential = await this.readCredential(normalizedQuery.connectionId);
    const items: ExternalCalendarEvent[] = [];
    const nextTokens = [...cursor.tokens];
    const done = [...cursor.done];

    for (let index = 0; index < normalizedQuery.calendarIds.length; index += 1) {
      if (done[index]) {
        continue;
      }

      const calendarId = normalizedQuery.calendarIds[index];
      const page = await this.fetchEventsPage(
        credential,
        calendarId,
        normalizedQuery.connectionId,
        normalizedQuery.startsAt,
        normalizedQuery.endsAt,
        nextTokens[index],
      );
      items.push(...page.items);

      if (page.nextPageToken === undefined) {
        nextTokens[index] = undefined;
        done[index] = true;
      } else {
        nextTokens[index] = page.nextPageToken;
        done[index] = false;
      }
    }

    if (done.every(Boolean)) {
      return { items };
    }

    if (normalizedQuery.calendarIds.length === 1) {
      const nextCursor = nextTokens[0];
      return nextCursor === undefined ? { items } : { items, nextCursor };
    }

    return {
      items,
      nextCursor: encodeCalendarCursor({
        version: 1,
        calendarIds: normalizedQuery.calendarIds,
        tokens: nextTokens,
        done,
      }),
    };
  }

  public async listEvents(query: CalendarEventQuery): Promise<Page<ExternalCalendarEvent>> {
    return this.listCalendarEvents(query);
  }

  public async eventsList(query: CalendarEventQuery): Promise<Page<ExternalCalendarEvent>> {
    return this.listCalendarEvents(query);
  }

  public async connectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      const normalizedConnectionId = requireConnectionId(connectionId);
      const credential = await this.readCredential(normalizedConnectionId);
      const { body } = await this.requestJson(credential, CALENDAR_PRIMARY_PATH);
      if (!isRecord(body)) {
        throw malformedResponse("Google Calendar 사용자 응답이 객체가 아닙니다.");
      }

      const accountLabel = firstNonEmptyString(body.summary, body.summaryOverride, body.id);
      return {
        state: "connected",
        ...(accountLabel === undefined ? {} : { accountLabel }),
      };
    } catch (error: unknown) {
      return connectionStatusForError(error);
    }
  }

  public async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    return this.connectionStatus(connectionId);
  }

  /** Local-only health: it checks initialization grants but never reads credentials or fetches. */
  public healthCheck(): ConnectionStatus {
    try {
      this.assertApprovedPermissions();
      return { state: "connected" };
    } catch (error: unknown) {
      return connectionStatusForError(error);
    }
  }

  private async fetchEventsPage(
    credential: CalendarCredential,
    calendarId: string,
    connectionId: string,
    startsAt: string,
    endsAt: string,
    pageToken?: string,
  ): Promise<CalendarEventPage> {
    const { body } = await this.requestJson(
      credential,
      buildCalendarEventsUrl(calendarId, startsAt, endsAt, pageToken),
      true,
    );
    if (!isRecord(body) || !Array.isArray(body.items)) {
      throw malformedResponse("Google Calendar events 응답 형식이 유효하지 않습니다.");
    }

    const items = body.items.map((value) => mapCalendarEvent(value, calendarId, connectionId));
    let nextPageToken: string | undefined;
    if (body.nextPageToken !== undefined && body.nextPageToken !== null) {
      try {
        nextPageToken = parsePageToken(body.nextPageToken);
      } catch {
        throw malformedResponse("Google Calendar events 응답의 nextPageToken이 유효하지 않습니다.");
      }
    }

    return { items, ...(nextPageToken === undefined ? {} : { nextPageToken }) };
  }

  private async readCredential(connectionId: string): Promise<CalendarCredential> {
    this.assertApprovedPermissions();
    let raw: string;
    try {
      raw = await this.credentialStore.get(CALENDAR_PLUGIN_ID, connectionId);
    } catch (error: unknown) {
      if (error instanceof CredentialStoreError && error.code === "CREDENTIAL_NOT_FOUND") {
        throw new CalendarPluginError(
          CALENDAR_ERROR_CODES.credentialNotFound,
          "Calendar credential을 찾지 못했습니다.",
        );
      }
      // Credential-store diagnostics may include command arguments or an accidental token.
      throw new CalendarPluginError(
        CALENDAR_ERROR_CODES.credentialError,
        "Calendar credential을 읽지 못했습니다.",
      );
    }

    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw malformedCredential();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw malformedCredential();
    }
    return parseCalendarCredential(parsed);
  }

  private async requestJson(
    credential: CalendarCredential,
    endpointOrUrl: string,
    isEventsUrl = false,
  ): Promise<CalendarJsonResponse> {
    const url = isEventsUrl ? endpointOrUrl : buildCalendarApiUrl(endpointOrUrl);
    const responseInit: RequestInit = {
      method: "GET",
      headers: {
        Accept: CALENDAR_ACCEPT_HEADER,
        Authorization: `Bearer ${credential.accessToken}`,
        "User-Agent": CALENDAR_USER_AGENT,
      },
    };

    let response: Response;
    try {
      response = await this.fetcher(url, responseInit);
    } catch {
      throw new CalendarPluginError(
        CALENDAR_ERROR_CODES.network,
        "Google Calendar API 요청에 실패했습니다.",
      );
    }

    const status = typeof response?.status === "number" ? response.status : undefined;
    const isSuccessful = response?.ok === true ||
      (response?.ok === undefined && status !== undefined && status >= 200 && status < 300);
    if (!isSuccessful) {
      throw classifyHttpError(response, status);
    }

    let body: unknown;
    try {
      if (typeof response.json !== "function") {
        throw new Error("response.json is not callable");
      }
      body = await response.json();
    } catch {
      throw malformedResponse("Google Calendar API 응답 JSON을 읽지 못했습니다.");
    }
    return { response, body };
  }
}

export {
  CalendarRestClient as CalendarApiClient,
  CalendarRestClient as GoogleCalendarRestClient,
  CalendarRestClient as GoogleCalendarApiClient,
  CalendarRestClient as GoogleCalendarClient,
};

export function createCalendarPluginHandlers(options: CalendarPluginHandlersOptions = {}): PluginHandlers {
  const client = options.client ?? new CalendarRestClient(options);
  let initialized = false;

  return {
    initialize: (params) => {
      initialized = false;
      const grantedPermissions = parseGrantedPermissions(params.grantedPermissions);
      client.setGrantedPermissions(grantedPermissions);
      client.assertApprovedPermissions();
      initialized = true;
      return { initialized: true };
    },
    healthCheck: () => initialized
      ? client.healthCheck()
      : { state: "error", message: "Calendar 플러그인이 초기화되지 않았습니다." },
    connectionStatus: async (params) => {
      if (!initialized) {
        return { state: "error", message: "Calendar 플러그인이 초기화되지 않았습니다." };
      }
      return client.connectionStatus(requireConnectionId(params.connectionId));
    },
    listCalendarEvents: async (params) => {
      if (!initialized) {
        throw new CalendarPluginError(
          CALENDAR_ERROR_CODES.notInitialized,
          "Calendar 플러그인이 초기화되지 않았습니다.",
        );
      }
      return client.listCalendarEvents(parseCalendarQuery(params));
    },
    shutdown: () => {
      initialized = false;
      return { shutdown: true };
    },
  };
}

export const createGoogleCalendarPluginHandlers = createCalendarPluginHandlers;
export const createCalendarHandlers = createCalendarPluginHandlers;
export const createGoogleCalendarHandlers = createCalendarPluginHandlers;
export const createHandlers = createCalendarPluginHandlers;
export const CALENDAR_PLUGIN_PROTOCOL_VERSION = PLUGIN_PROTOCOL_VERSION;

export function parseCalendarQuery(value: unknown): CalendarEventQuery {
  if (!isRecord(value)) {
    throw invalidInput("Calendar 일정 조회 파라미터가 유효하지 않습니다.");
  }

  const connectionId = requireConnectionId(value.connectionId);
  const calendarIds = parseCalendarIds(value.calendarIds, value.calendarId);
  const startsAt = requireRfc3339(value.startsAt ?? value.timeMin, "startsAt");
  const endsAt = requireRfc3339(value.endsAt ?? value.timeMax, "endsAt");
  if (Date.parse(startsAt) > Date.parse(endsAt)) {
    throw invalidInput("Calendar 일정 조회 시간 범위가 유효하지 않습니다.");
  }

  const cursor = value.cursor;
  const pageToken = value.pageToken;
  if (cursor !== undefined && cursor !== null && pageToken !== undefined && pageToken !== null) {
    if (typeof cursor !== "string" || typeof pageToken !== "string" || cursor !== pageToken) {
      throw invalidInput("Calendar page cursor가 유효하지 않습니다.");
    }
  }

  const resolvedCursor = pageToken ?? cursor;
  if (resolvedCursor !== undefined && resolvedCursor !== null) {
    const cursorText = parseCursorText(resolvedCursor);
    if (calendarIds.length === 1 && !cursorText.startsWith(MULTI_CURSOR_PREFIX)) {
      parsePageToken(cursorText);
    }
  }

  return {
    connectionId,
    calendarIds,
    startsAt,
    endsAt,
    ...(typeof resolvedCursor === "string" ? { cursor: resolvedCursor } : {}),
  };
}

export const parseCalendarEventQuery = parseCalendarQuery;
export const parseGoogleCalendarQuery = parseCalendarQuery;

export function parseCalendarCredential(value: unknown): CalendarCredential {
  if (!isRecord(value) || typeof value.accessToken !== "string") {
    throw malformedCredential();
  }
  const accessToken = value.accessToken;
  if (
    accessToken.trim().length === 0 ||
    accessToken.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(accessToken)
  ) {
    throw malformedCredential();
  }
  return { accessToken };
}

export const parseGoogleCalendarCredential = parseCalendarCredential;

export function buildCalendarEventsUrl(
  calendarId: string,
  startsAt: string,
  endsAt: string,
  pageToken?: string,
): string {
  const normalizedCalendarId = requireCalendarId(calendarId);
  const normalizedStartsAt = requireRfc3339(startsAt, "startsAt");
  const normalizedEndsAt = requireRfc3339(endsAt, "endsAt");
  if (Date.parse(normalizedStartsAt) > Date.parse(normalizedEndsAt)) {
    throw invalidInput("Calendar 일정 조회 시간 범위가 유효하지 않습니다.");
  }
  const params = new URLSearchParams({
    timeMin: normalizedStartsAt,
    timeMax: normalizedEndsAt,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(CALENDAR_PAGE_SIZE),
  });
  if (pageToken !== undefined) {
    params.set("pageToken", parsePageToken(pageToken));
  }
  return `${CALENDAR_API_BASE_URL}${CALENDAR_EVENTS_PATH}/${encodeURIComponent(normalizedCalendarId)}/events?${params.toString()}`;
}

export const buildGoogleCalendarEventsUrl = buildCalendarEventsUrl;
export const buildEventsListUrl = buildCalendarEventsUrl;
export const buildGoogleCalendarEventsListUrl = buildCalendarEventsUrl;

function normalizeCalendarQuery(value: CalendarEventQuery): CalendarEventQuery {
  return parseCalendarQuery(value);
}

function parseGrantedPermissions(value: unknown): PluginPermissions {
  if (!isRecord(value)) {
    throw new CalendarPluginError(
      CALENDAR_ERROR_CODES.permissionDenied,
      "Calendar 플러그인 권한 승인이 필요합니다.",
    );
  }
  try {
    return normalizePermissions(value as PluginPermissions);
  } catch {
    throw new CalendarPluginError(
      CALENDAR_ERROR_CODES.permissionDenied,
      "Calendar 플러그인 권한이 유효하지 않습니다.",
    );
  }
}

function parseCalendarIds(value: unknown, calendarIdAlias: unknown): string[] {
  let values: unknown = value;
  if (values === undefined && calendarIdAlias !== undefined) {
    values = [calendarIdAlias];
  }
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw invalidInput("Calendar calendarIds는 하나 이상의 목록이어야 합니다.");
  }
  const ids = values.map((entry) => requireCalendarId(entry));
  if (new Set(ids).size !== ids.length) {
    throw invalidInput("Calendar calendarIds에 중복 항목이 있습니다.");
  }
  return ids;
}

function requireConnectionId(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Calendar connectionId가 필요합니다.");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw invalidInput("Calendar connectionId가 유효하지 않습니다.");
  }
  return normalized;
}

function requireCalendarId(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Calendar calendarId가 유효하지 않습니다.");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 512 ||
    /[\u0000-\u0020\u007f/\\?#]/.test(normalized)
  ) {
    throw invalidInput("Calendar calendarId가 유효하지 않습니다.");
  }
  return normalized;
}

function requireRfc3339(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalidInput(`Calendar ${field}가 RFC3339 형식이어야 합니다.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    throw invalidInput(`Calendar ${field}가 RFC3339 형식이어야 합니다.`);
  }
  return normalized;
}

function parseCalendarCursor(value: unknown, calendarIds: string[]): CalendarPageCursor {
  if (value === undefined || value === null) {
    return {
      version: 1,
      calendarIds: [...calendarIds],
      tokens: calendarIds.map(() => undefined),
      done: calendarIds.map(() => false),
    };
  }
  const text = parseCursorText(value);
  if (!text.startsWith(MULTI_CURSOR_PREFIX)) {
    if (calendarIds.length !== 1) {
      throw invalidInput("여러 Calendar의 page cursor가 유효하지 않습니다.");
    }
    return {
      version: 1,
      calendarIds: [...calendarIds],
      tokens: [text],
      done: [false],
    };
  }

  let parsed: unknown;
  try {
    const encoded = text.slice(MULTI_CURSOR_PREFIX.length);
    if (encoded.length === 0) {
      throw new Error("empty cursor");
    }
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw invalidInput("Calendar page cursor가 유효하지 않습니다.");
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.calendarIds) || !Array.isArray(parsed.tokens) || !Array.isArray(parsed.done)) {
    throw invalidInput("Calendar page cursor가 유효하지 않습니다.");
  }
  if (
    parsed.calendarIds.length !== calendarIds.length ||
    parsed.tokens.length !== calendarIds.length ||
    parsed.done.length !== calendarIds.length ||
    !parsed.calendarIds.every((entry, index) => entry === calendarIds[index]) ||
    !parsed.done.every((entry) => typeof entry === "boolean")
  ) {
    throw invalidInput("Calendar page cursor가 현재 Calendar 목록과 일치하지 않습니다.");
  }

  const tokens = parsed.tokens.map((token, index) => {
    if (token === null || token === undefined) {
      return undefined;
    }
    try {
      return parsePageToken(token);
    } catch {
      throw invalidInput(`Calendar page cursor ${index + 1}번 token이 유효하지 않습니다.`);
    }
  });
  return {
    version: 1,
    calendarIds: [...calendarIds],
    tokens,
    done: [...parsed.done] as boolean[],
  };
}

function parseCursorText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CALENDAR_MAX_CURSOR_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidInput("Calendar page cursor가 유효하지 않습니다.");
  }
  return value;
}

function parsePageToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CALENDAR_MAX_PAGE_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidInput("Calendar page cursor가 유효하지 않습니다.");
  }
  return value;
}

function encodeCalendarCursor(cursor: CalendarPageCursor): string {
  const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  const value = `${MULTI_CURSOR_PREFIX}${encoded}`;
  if (value.length > CALENDAR_MAX_CURSOR_LENGTH) {
    throw new CalendarPluginError(
      CALENDAR_ERROR_CODES.malformedResponse,
      "Google Calendar page cursor가 너무 깁니다.",
    );
  }
  return value;
}

export function mapCalendarEvent(
  value: unknown,
  calendarId: string,
  connectionId = "",
): ExternalCalendarEvent {
  if (!isRecord(value)) {
    throw malformedResponse("Google Calendar event 응답 항목이 객체가 아닙니다.");
  }
  const normalizedCalendarId = requireCalendarId(calendarId);
  const normalizedConnectionId = connectionId.length === 0 ? "" : requireConnectionId(connectionId);
  const externalId = requiredResponseText(value.id, "id");
  if (externalId.length > 1024) {
    throw malformedResponse("Google Calendar event id가 유효하지 않습니다.");
  }

  const start = parseEventTime(value.start, "start");
  const end = parseEventTime(value.end, "end");
  if (start.allDay !== end.allDay) {
    throw malformedResponse("Google Calendar event start와 end 형식이 일치하지 않습니다.");
  }

  const status = mapEventStatus(value.status);
  const title = value.summary === undefined || value.summary === null
    ? ""
    : requiredResponseText(value.summary, "summary");
  const sourceUrl = optionalResponseText(value.htmlLink, "htmlLink");
  const updatedAt = optionalResponseText(value.updated, "updated");

  return {
    providerId: CALENDAR_PROVIDER_ID,
    connectionId: normalizedConnectionId,
    externalId,
    calendarId: normalizedCalendarId,
    title,
    startsAt: start.value,
    endsAt: end.value,
    allDay: start.allDay,
    status,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export const mapGoogleCalendarEvent = mapCalendarEvent;

function mapEventStatus(value: unknown): ExternalCalendarEvent["status"] {
  if (value === undefined || value === null) {
    return "confirmed";
  }
  if (typeof value !== "string") {
    throw malformedResponse("Google Calendar event status가 유효하지 않습니다.");
  }
  switch (value.toLowerCase()) {
    case "confirmed":
      return "confirmed";
    case "tentative":
      return "tentative";
    case "cancelled":
      return "cancelled";
    default:
      throw malformedResponse("Google Calendar event status를 매핑하지 못했습니다.");
  }
}

function parseEventTime(value: unknown, field: string): { value: string; allDay: boolean } {
  if (!isRecord(value)) {
    throw malformedResponse(`Google Calendar event ${field}가 유효하지 않습니다.`);
  }
  const dateTime = value.dateTime;
  const date = value.date;
  if (dateTime !== undefined && dateTime !== null) {
    if (
      typeof dateTime !== "string" ||
      dateTime.length === 0 ||
      dateTime.length > 128 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(dateTime) ||
      Number.isNaN(Date.parse(dateTime))
    ) {
      throw malformedResponse(`Google Calendar event ${field}.dateTime이 유효하지 않습니다.`);
    }
    if (date !== undefined && date !== null) {
      throw malformedResponse(`Google Calendar event ${field}에 date와 dateTime이 함께 있습니다.`);
    }
    return { value: dateTime, allDay: false };
  }
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  ) {
    throw malformedResponse(`Google Calendar event ${field}.date가 유효하지 않습니다.`);
  }
  return { value: date, allDay: true };
}

function buildCalendarApiUrl(endpoint: string): string {
  if (endpoint !== CALENDAR_PRIMARY_PATH) {
    throw new CalendarPluginError(
      CALENDAR_ERROR_CODES.invalidInput,
      "Google Calendar API 경로가 유효하지 않습니다.",
    );
  }
  return `${CALENDAR_API_BASE_URL}${endpoint}`;
}

function classifyHttpError(response: Response, status: number | undefined): CalendarPluginError {
  const numericStatus = status ?? 0;
  if (numericStatus === 401 || numericStatus === 403) {
    return new CalendarPluginError(
      CALENDAR_ERROR_CODES.auth,
      "Google Calendar 인증 또는 연결 권한이 유효하지 않습니다.",
      { status: numericStatus },
    );
  }
  if (numericStatus === 404) {
    return new CalendarPluginError(
      CALENDAR_ERROR_CODES.notFound,
      "Google Calendar 리소스를 찾지 못했습니다.",
      { status: numericStatus },
    );
  }
  if (numericStatus === 429 || responseHeader(response, "retry-after") !== undefined) {
    return new CalendarPluginError(
      CALENDAR_ERROR_CODES.rateLimit,
      "Google Calendar API 요청 한도를 초과했습니다.",
      { status: numericStatus },
    );
  }
  return new CalendarPluginError(
    CALENDAR_ERROR_CODES.http,
    numericStatus > 0
      ? `Google Calendar API가 HTTP ${numericStatus} 오류를 반환했습니다.`
      : "Google Calendar API 응답이 유효하지 않습니다.",
    { status: numericStatus > 0 ? numericStatus : undefined },
  );
}

function connectionStatusForError(error: unknown): ConnectionStatus {
  if (error instanceof CalendarPluginError) {
    switch (error.code) {
      case "CREDENTIAL_NOT_FOUND":
        return { state: "needs-auth", message: "Calendar 인증 정보가 없습니다." };
      case "MALFORMED_CREDENTIAL":
        return { state: "needs-auth", message: "Calendar 인증 정보 형식이 올바르지 않습니다." };
      case "AUTH_ERROR":
        return { state: "needs-auth", message: "Calendar 인증 또는 연결 권한을 확인해 주세요." };
      case "PERMISSION_DENIED":
      case "INVALID_INPUT":
      case "NOT_INITIALIZED":
        return { state: "error", message: error.message };
      case "NOT_FOUND":
        return { state: "error", message: "Calendar 연결 대상을 찾지 못했습니다." };
      case "RATE_LIMITED":
      case "CREDENTIAL_ERROR":
      case "HTTP_ERROR":
      case "MALFORMED_RESPONSE":
      case "NETWORK_ERROR":
        return { state: "error", message: error.message };
    }
  }
  return { state: "error", message: "Calendar 연결 상태를 확인하지 못했습니다." };
}

function malformedCredential(): CalendarPluginError {
  return new CalendarPluginError(
    CALENDAR_ERROR_CODES.malformedCredential,
    "Calendar credential 형식이 유효하지 않습니다.",
  );
}

function malformedResponse(message: string): CalendarPluginError {
  return new CalendarPluginError(CALENDAR_ERROR_CODES.malformedResponse, message);
}

function invalidInput(message: string): CalendarPluginError {
  return new CalendarPluginError(CALENDAR_ERROR_CODES.invalidInput, message);
}

function requiredResponseText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw malformedResponse(`Google Calendar event ${field}가 유효하지 않습니다.`);
  }
  return value;
}

function optionalResponseText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw malformedResponse(`Google Calendar event ${field}가 유효하지 않습니다.`);
  }
  return value;
}

function responseHeader(response: Response, name: string): string | undefined {
  const headers = response?.headers as unknown;
  if (isRecord(headers)) {
    const getter = headers.get;
    if (typeof getter === "function") {
      const value = getter.call(headers, name);
      return typeof value === "string" ? value : undefined;
    }
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name.toLowerCase() && typeof value === "string") {
        return value;
      }
    }
  }
  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultCalendarFetch: CalendarFetch = (input, init) => globalThis.fetch(input, init);
