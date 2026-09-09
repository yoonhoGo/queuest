import {
  PLUGIN_PROTOCOL_VERSION,
  type ConnectionStatus,
  type ExternalWorkItem,
  type JsonObject,
  type Page,
  type PluginPermissions,
  type WorkItemQuery,
} from "@queuest/plugin-contracts";
import {
  CredentialStoreError,
  MacOSKeychainCredentialStore,
  normalizePermissions,
  type CredentialStore,
} from "@queuest/plugin-permissions";
import type { PluginHandlers } from "@queuest/plugin-sdk";

export const JIRA_PLUGIN_ID = "com.queuest.jira" as const;
export const JIRA_PROVIDER_ID = "jira" as const;
export const JIRA_NETWORK_PERMISSION = "*.atlassian.net" as const;
export const JIRA_SECRET_PERMISSION = "jira" as const;
export const JIRA_API_VERSION = "3" as const;
export const JIRA_SEARCH_PATH = "/rest/api/3/search/jql" as const;
export const JIRA_MYSELF_PATH = "/rest/api/3/myself" as const;
export const JIRA_PAGE_SIZE = 100 as const;
export const JIRA_MAX_NEXT_PAGE_TOKEN_LENGTH = 1024 as const;
export const JIRA_USER_AGENT = "Queuest Jira Plugin/0.1.0" as const;
export const JIRA_ACCEPT_HEADER = "application/json" as const;
export const JIRA_CONTENT_TYPE = "application/json" as const;

export const JIRA_ERROR_CODES = {
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

export type JiraPluginErrorCode = (typeof JIRA_ERROR_CODES)[keyof typeof JIRA_ERROR_CODES];

/** Safe, provider-specific failures. Error messages never contain credentials or API responses. */
export class JiraPluginError extends Error {
  public readonly code: JiraPluginErrorCode;
  public readonly status?: number;

  public constructor(
    code: JiraPluginErrorCode,
    message: string,
    options?: { status?: number },
  ) {
    super(message);
    this.code = code;
    this.status = options?.status;
    this.name = "JiraPluginError";
  }
}

export interface JiraFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface JiraRestClientOptions {
  fetch?: JiraFetch;
  credentialStore?: CredentialStore;
  grantedPermissions?: PluginPermissions;
  /** Alias useful to callers that name the initialize grant simply permissions. */
  permissions?: PluginPermissions;
}

export interface JiraPluginHandlersOptions extends JiraRestClientOptions {
  client?: JiraRestClient;
}

/** The JSON shape stored in CredentialStore for a Jira connection. */
export interface JiraCredential {
  siteUrl?: string;
  baseUrl?: string;
  email: string;
  apiToken: string;
}

/** Jira extends the shared query with the provider's cursor name as a compatibility alias. */
export interface JiraWorkItemQuery extends WorkItemQuery {
  nextPageToken?: string;
}

interface ResolvedJiraCredential {
  baseUrl: string;
  hostname: string;
  email: string;
  apiToken: string;
}

interface JiraJsonResponse {
  response: Response;
  body: unknown;
}

interface JiraIssueResponse {
  id?: unknown;
  key?: unknown;
  fields?: unknown;
}

/**
 * Small Jira Cloud REST client. The site URL comes from a validated credential;
 * request paths themselves are fixed constants so provider input cannot replace
 * the host or inject an arbitrary path or port.
 */
export class JiraRestClient {
  private readonly fetcher: JiraFetch;
  private readonly credentialStore: CredentialStore;
  private grantedPermissions: PluginPermissions;

  public constructor(options?: JiraRestClientOptions);
  public constructor(
    fetcher: JiraFetch,
    credentialStore?: CredentialStore,
    grantedPermissions?: PluginPermissions,
  );
  public constructor(
    optionsOrFetcher: JiraRestClientOptions | JiraFetch = {},
    credentialStore?: CredentialStore,
    grantedPermissions?: PluginPermissions,
  ) {
    if (typeof optionsOrFetcher === "function") {
      this.fetcher = optionsOrFetcher;
      this.credentialStore = credentialStore ?? new MacOSKeychainCredentialStore();
      this.grantedPermissions = clonePermissions(grantedPermissions ?? {});
      return;
    }

    this.fetcher = optionsOrFetcher.fetch ?? defaultJiraFetch;
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
      throw new JiraPluginError(
        JIRA_ERROR_CODES.permissionDenied,
        "Jira 플러그인 권한이 유효하지 않습니다.",
      );
    }

    const hasNetworkPermission = normalized.network?.includes(JIRA_NETWORK_PERMISSION) ?? false;
    const hasSecretPermission = normalized.secrets?.includes(JIRA_SECRET_PERMISSION) ?? false;
    if (!hasNetworkPermission || !hasSecretPermission) {
      throw new JiraPluginError(
        JIRA_ERROR_CODES.permissionDenied,
        "Jira 플러그인의 API 및 credential 권한 승인이 필요합니다.",
      );
    }
  }

  public async listWorkItems(query: JiraWorkItemQuery): Promise<Page<ExternalWorkItem>> {
    // Keep the permission gate ahead of credential retrieval and API construction.
    this.assertApprovedPermissions();
    if (!isRecord(query)) {
      throw invalidInput("Jira 작업 항목 조회 파라미터가 유효하지 않습니다.");
    }

    const connectionId = requireConnectionId(query.connectionId);
    const projectKey = requireProjectKey(query.projectKey);
    const nextPageToken = parseNextPageToken(query.cursor, query.nextPageToken);
    const credential = await this.readCredential(connectionId);
    const payload: Record<string, unknown> = {
      jql: buildJiraProjectJql(projectKey),
      maxResults: JIRA_PAGE_SIZE,
      fields: ["summary", "description", "labels", "updated", "status"],
    };
    if (nextPageToken !== undefined) {
      payload.nextPageToken = nextPageToken;
    }

    const { body } = await this.requestJson(
      credential,
      JIRA_SEARCH_PATH,
      "POST",
      payload,
    );
    return mapSearchResponse(body, connectionId, credential);
  }

  public async listIssues(query: JiraWorkItemQuery): Promise<Page<ExternalWorkItem>> {
    return this.listWorkItems(query);
  }

  public async connectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      const normalizedConnectionId = requireConnectionId(connectionId);
      const credential = await this.readCredential(normalizedConnectionId);
      const { body } = await this.requestJson(credential, JIRA_MYSELF_PATH, "GET");
      if (!isRecord(body)) {
        throw malformedResponse("Jira 사용자 응답이 객체가 아닙니다.");
      }

      const accountLabel = firstNonEmptyString(body.displayName, body.emailAddress, body.accountId);
      if (accountLabel === undefined) {
        throw malformedResponse("Jira 사용자 응답의 account label이 유효하지 않습니다.");
      }
      return {
        state: "connected",
        accountLabel,
      };
    } catch (error: unknown) {
      return connectionStatusForError(error);
    }
  }

  public async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    return this.connectionStatus(connectionId);
  }

  /** Local-only health: it checks initialization and grants but never reads credentials or fetches. */
  public healthCheck(): ConnectionStatus {
    try {
      this.assertApprovedPermissions();
      return { state: "connected" };
    } catch (error: unknown) {
      return connectionStatusForError(error);
    }
  }

  private async readCredential(connectionId: string): Promise<ResolvedJiraCredential> {
    this.assertApprovedPermissions();
    let raw: string;
    try {
      raw = await this.credentialStore.get(JIRA_PLUGIN_ID, connectionId);
    } catch (error: unknown) {
      if (error instanceof CredentialStoreError && error.code === "CREDENTIAL_NOT_FOUND") {
        throw new JiraPluginError(
          JIRA_ERROR_CODES.credentialNotFound,
          "Jira credential을 찾지 못했습니다.",
        );
      }
      // Credential-store diagnostics may include command arguments or an accidental secret.
      throw new JiraPluginError(
        JIRA_ERROR_CODES.credentialError,
        "Jira credential을 읽지 못했습니다.",
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
    return parseJiraCredential(parsed);
  }

  private async requestJson(
    credential: ResolvedJiraCredential,
    endpoint: typeof JIRA_SEARCH_PATH | typeof JIRA_MYSELF_PATH,
    method: "GET" | "POST",
    payload?: Record<string, unknown>,
  ): Promise<JiraJsonResponse> {
    const url = buildJiraApiUrl(credential.baseUrl, endpoint);
    const authorization = Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64");
    const init: RequestInit = {
      method,
      headers: {
        Accept: JIRA_ACCEPT_HEADER,
        Authorization: `Basic ${authorization}`,
        "Content-Type": JIRA_CONTENT_TYPE,
        "User-Agent": JIRA_USER_AGENT,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    };

    let response: Response;
    try {
      response = await this.fetcher(url, init);
    } catch {
      throw new JiraPluginError(
        JIRA_ERROR_CODES.network,
        "Jira API 요청에 실패했습니다.",
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
      throw malformedResponse("Jira API 응답 JSON을 읽지 못했습니다.");
    }
    return { response, body };
  }
}

/** Aliases retained for callers that use Jira's common API/client naming. */
export {
  JiraRestClient as JiraApiClient,
  JiraRestClient as JiraClient,
  JiraPluginError as JiraApiError,
};

export function createJiraPluginHandlers(options: JiraPluginHandlersOptions = {}): PluginHandlers {
  const client = options.client ?? new JiraRestClient(options);
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
      : { state: "error", message: "Jira 플러그인이 초기화되지 않았습니다." },
    connectionStatus: async (params) => {
      if (!initialized) {
        return { state: "error", message: "Jira 플러그인이 초기화되지 않았습니다." };
      }
      return client.connectionStatus(requireConnectionId(params.connectionId));
    },
    listWorkItems: async (params) => {
      if (!initialized) {
        throw new JiraPluginError(
          JIRA_ERROR_CODES.notInitialized,
          "Jira 플러그인이 초기화되지 않았습니다.",
        );
      }
      return client.listWorkItems(parseWorkItemQuery(params));
    },
    shutdown: () => {
      initialized = false;
      return { shutdown: true };
    },
  };
}

export const createJiraHandlers = createJiraPluginHandlers;
export const createHandlers = createJiraPluginHandlers;
export const createJIRAPluginHandlers = createJiraPluginHandlers;
export const JIRA_PLUGIN_PROTOCOL_VERSION = PLUGIN_PROTOCOL_VERSION;

export function buildJiraProjectJql(projectKey: string): string {
  const normalized = requireProjectKey(projectKey);
  return `project = "${normalized}" ORDER BY updated DESC`;
}

export const buildProjectJql = buildJiraProjectJql;
export const buildJql = buildJiraProjectJql;

/**
 * Returns a canonical site origin for an Atlassian Cloud tenant. Paths, ports,
 * credentials, queries, fragments, and non-Atlassian hosts are rejected.
 */
export function validateJiraSiteUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Jira site URL이 유효하지 않습니다.");
  }
  const input = value.trim();
  if (input.length === 0 || input.length > 512) {
    throw invalidInput("Jira site URL이 유효하지 않습니다.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw invalidInput("Jira site URL이 유효하지 않습니다.");
  }

  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw invalidInput("Jira site URL이 유효하지 않습니다.");
  }

  // URL normalizes an explicit default :443 away, so inspect the authority too.
  const authority = input.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i)?.[1];
  if (authority === undefined || authority.includes("@") || authority.includes(":")) {
    throw invalidInput("Jira site URL이 유효하지 않습니다.");
  }

  const host = parsed.hostname.toLowerCase();
  const labels = host.split(".");
  const hasAtlassianCloudSuffix = labels.length >= 3 &&
    labels.at(-2) === "atlassian" &&
    labels.at(-1) === "net";
  const hasValidLabels = labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
  if (!hasAtlassianCloudSuffix || !hasValidLabels) {
    throw invalidInput("Jira site URL이 유효하지 않습니다.");
  }

  const suffix = input.slice(input.indexOf(authority) + authority.length);
  if (suffix !== "" && suffix !== "/") {
    throw invalidInput("Jira site URL은 Atlassian Cloud 사이트 origin이어야 합니다.");
  }

  return `https://${host}`;
}

function parseGrantedPermissions(value: unknown): PluginPermissions {
  if (!isRecord(value)) {
    throw new JiraPluginError(
      JIRA_ERROR_CODES.permissionDenied,
      "Jira 플러그인 권한 승인이 필요합니다.",
    );
  }
  try {
    return normalizePermissions(value as PluginPermissions);
  } catch {
    throw new JiraPluginError(
      JIRA_ERROR_CODES.permissionDenied,
      "Jira 플러그인 권한이 유효하지 않습니다.",
    );
  }
}

function parseWorkItemQuery(params: JsonObject): JiraWorkItemQuery {
  const connectionId = requireConnectionId(params.connectionId);
  const projectKey = requireProjectKey(params.projectKey);
  const cursor = params.cursor;
  const nextPageToken = params.nextPageToken;
  parseNextPageToken(cursor, nextPageToken);
  return {
    connectionId,
    projectKey,
    ...(typeof cursor === "string" ? { cursor } : {}),
    ...(typeof nextPageToken === "string" ? { nextPageToken } : {}),
  };
}

function requireConnectionId(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Jira connectionId가 필요합니다.");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw invalidInput("Jira connectionId가 유효하지 않습니다.");
  }
  return normalized;
}

function requireProjectKey(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Jira projectKey가 유효하지 않습니다.");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 50 ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(normalized)
  ) {
    throw invalidInput("Jira projectKey가 유효하지 않습니다.");
  }
  return normalized;
}

function parseNextPageToken(cursor: unknown, nextPageToken: unknown): string | undefined {
  if (cursor !== undefined && cursor !== null && nextPageToken !== undefined && nextPageToken !== null) {
    if (typeof cursor !== "string" || typeof nextPageToken !== "string" || cursor !== nextPageToken) {
      throw invalidInput("Jira nextPageToken cursor가 유효하지 않습니다.");
    }
  }

  const value = nextPageToken ?? cursor;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > JIRA_MAX_NEXT_PAGE_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidInput("Jira nextPageToken cursor가 유효하지 않습니다.");
  }
  return value;
}

function parseJiraCredential(value: unknown): ResolvedJiraCredential {
  if (!isRecord(value)) {
    throw malformedCredential();
  }

  const siteUrl = value.siteUrl;
  const baseUrl = value.baseUrl;
  if (siteUrl === undefined && baseUrl === undefined) {
    throw malformedCredential();
  }
  if (
    (siteUrl !== undefined && typeof siteUrl !== "string") ||
    (baseUrl !== undefined && typeof baseUrl !== "string")
  ) {
    throw malformedCredential();
  }

  let canonicalSiteUrl: string;
  try {
    canonicalSiteUrl = validateJiraSiteUrl(siteUrl ?? baseUrl);
    if (siteUrl !== undefined && baseUrl !== undefined) {
      const canonicalBaseUrl = validateJiraSiteUrl(baseUrl);
      if (canonicalBaseUrl !== canonicalSiteUrl) {
        throw new Error("credential site URLs differ");
      }
    }
  } catch {
    throw malformedCredential();
  }

  if (typeof value.email !== "string" || typeof value.apiToken !== "string") {
    throw malformedCredential();
  }
  const email = value.email.trim();
  const apiToken = value.apiToken;
  if (
    email.length === 0 ||
    email.length > 320 ||
    !/^[^\s:@]+@[^\s:@]+$/.test(email) ||
    /[\u0000-\u001f\u007f]/.test(email) ||
    apiToken.length === 0 ||
    apiToken.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(apiToken)
  ) {
    throw malformedCredential();
  }

  return {
    baseUrl: canonicalSiteUrl,
    hostname: new URL(canonicalSiteUrl).hostname,
    email,
    apiToken,
  };
}

function buildJiraApiUrl(
  baseUrl: string,
  endpoint: typeof JIRA_SEARCH_PATH | typeof JIRA_MYSELF_PATH,
): string {
  if (endpoint !== JIRA_SEARCH_PATH && endpoint !== JIRA_MYSELF_PATH) {
    throw invalidInput("Jira API 경로가 유효하지 않습니다.");
  }
  return `${baseUrl}${endpoint}`;
}

function mapSearchResponse(
  body: unknown,
  connectionId: string,
  credential: ResolvedJiraCredential,
): Page<ExternalWorkItem> {
  if (!isRecord(body) || !Array.isArray(body.issues) || typeof body.isLast !== "boolean") {
    throw malformedResponse("Jira 검색 응답 형식이 유효하지 않습니다.");
  }

  const items = body.issues.map((issue) => mapIssue(issue, connectionId, credential));
  let responseToken: string | undefined;
  if (body.nextPageToken !== undefined && body.nextPageToken !== null) {
    try {
      responseToken = parseNextPageToken(body.nextPageToken, undefined);
    } catch {
      throw malformedResponse("Jira 검색 응답의 nextPageToken이 유효하지 않습니다.");
    }
  }

  if (body.isLast) {
    return { items };
  }
  if (responseToken === undefined) {
    throw malformedResponse("Jira 검색 응답에 nextPageToken이 없습니다.");
  }
  return { items, nextCursor: responseToken };
}

function mapIssue(
  value: unknown,
  connectionId: string,
  credential: ResolvedJiraCredential,
): ExternalWorkItem {
  if (!isRecord(value)) {
    throw malformedResponse("Jira issue 응답 항목이 객체가 아닙니다.");
  }
  const issue = value as JiraIssueResponse;
  const issueKey = requireIssueKey(issue.key);
  const fields = issue.fields;
  if (!isRecord(fields)) {
    throw malformedResponse("Jira issue fields가 유효하지 않습니다.");
  }

  const externalId = parseIssueId(issue.id, issueKey);
  const title = requiredResponseText(fields.summary, "summary");
  const body = mapDescription(fields.description);
  const labels = mapLabels(fields.labels);
  const status = mapStatus(fields.status);
  const updatedAt = fields.updated;
  if (updatedAt !== undefined && updatedAt !== null && typeof updatedAt !== "string") {
    throw malformedResponse("Jira issue updated가 유효하지 않습니다.");
  }

  return {
    providerId: JIRA_PROVIDER_ID,
    connectionId,
    externalId,
    externalRef: `jira:${credential.hostname}/${issueKey}`,
    sourceUrl: buildBrowseUrl(credential.baseUrl, issueKey),
    title,
    body,
    status,
    labels,
    ...(typeof updatedAt === "string" && updatedAt.length > 0 ? { updatedAt } : {}),
  };
}

function parseIssueId(value: unknown, fallbackKey: string): string {
  if (value === undefined || value === null) {
    return fallbackKey;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  throw malformedResponse("Jira issue id가 유효하지 않습니다.");
}

function requireIssueKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(value)) {
    throw malformedResponse("Jira issue key가 유효하지 않습니다.");
  }
  return value;
}

function requiredResponseText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw malformedResponse(`Jira issue ${field}가 유효하지 않습니다.`);
  }
  return value;
}

function mapDescription(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value) || value.type !== "doc") {
    throw malformedResponse("Jira issue description이 문자열 또는 ADF 문서가 아닙니다.");
  }
  if (value.version !== undefined && value.version !== 1) {
    throw malformedResponse("Jira ADF description version이 유효하지 않습니다.");
  }
  if (!Array.isArray(value.content)) {
    throw malformedResponse("Jira ADF description content가 유효하지 않습니다.");
  }
  return value.content.map((node) => mapAdfNode(node)).join("\n");
}

const ADF_BLOCK_CONTAINERS = new Set([
  "doc",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "panel",
  "expand",
  "taskList",
  "taskItem",
]);

function mapAdfNode(value: unknown): string {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw malformedResponse("Jira ADF node가 유효하지 않습니다.");
  }
  if (value.type === "text") {
    if (typeof value.text !== "string") {
      throw malformedResponse("Jira ADF text node가 유효하지 않습니다.");
    }
    return value.text;
  }
  if (value.type === "hardBreak") {
    return "\n";
  }
  if (value.content === undefined) {
    return "";
  }
  if (!Array.isArray(value.content)) {
    throw malformedResponse("Jira ADF node content가 유효하지 않습니다.");
  }
  const children = value.content.map((node) => mapAdfNode(node));
  return children.join(ADF_BLOCK_CONTAINERS.has(value.type) ? "\n" : "");
}

function mapLabels(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((label) => typeof label === "string")) {
    throw malformedResponse("Jira issue labels가 문자열 배열이 아닙니다.");
  }
  return value as string[];
}

function mapStatus(value: unknown): ExternalWorkItem["status"] {
  if (!isRecord(value) || !isRecord(value.statusCategory) || typeof value.statusCategory.key !== "string") {
    throw malformedResponse("Jira issue status category가 유효하지 않습니다.");
  }
  switch (value.statusCategory.key.toLowerCase()) {
    case "new":
    case "todo":
    case "to-do":
      return "open";
    case "indeterminate":
    case "in-progress":
    case "in progress":
      return "in_progress";
    case "done":
    case "closed":
      return "closed";
    default:
      throw malformedResponse("Jira issue status category를 매핑하지 못했습니다.");
  }
}

function buildBrowseUrl(baseUrl: string, issueKey: string): string {
  return `${baseUrl}/browse/${encodeURIComponent(issueKey)}`;
}

function classifyHttpError(response: Response, status: number | undefined): JiraPluginError {
  const numericStatus = status ?? 0;
  if (numericStatus === 401 || numericStatus === 403) {
    return new JiraPluginError(
      JIRA_ERROR_CODES.auth,
      "Jira 인증 또는 연결 권한이 유효하지 않습니다.",
      { status: numericStatus },
    );
  }
  if (numericStatus === 404) {
    return new JiraPluginError(
      JIRA_ERROR_CODES.notFound,
      "Jira 리소스를 찾지 못했습니다.",
      { status: numericStatus },
    );
  }
  if (numericStatus === 429 || responseHeader(response, "retry-after") !== undefined) {
    return new JiraPluginError(
      JIRA_ERROR_CODES.rateLimit,
      "Jira API 요청 한도를 초과했습니다.",
      { status: numericStatus },
    );
  }
  return new JiraPluginError(
    JIRA_ERROR_CODES.http,
    numericStatus > 0
      ? `Jira API가 HTTP ${numericStatus} 오류를 반환했습니다.`
      : "Jira API 응답이 유효하지 않습니다.",
    { status: numericStatus > 0 ? numericStatus : undefined },
  );
}

function connectionStatusForError(error: unknown): ConnectionStatus {
  if (error instanceof JiraPluginError) {
    switch (error.code) {
      case "CREDENTIAL_NOT_FOUND":
        return { state: "needs-auth", message: "Jira 인증 정보가 없습니다." };
      case "MALFORMED_CREDENTIAL":
        return { state: "needs-auth", message: "Jira 인증 정보 형식이 올바르지 않습니다." };
      case "AUTH_ERROR":
        return { state: "needs-auth", message: "Jira 인증 또는 연결 권한을 확인해 주세요." };
      case "PERMISSION_DENIED":
      case "INVALID_INPUT":
      case "NOT_INITIALIZED":
        return { state: "error", message: error.message };
      case "NOT_FOUND":
        return { state: "error", message: "Jira 연결 대상을 찾지 못했습니다." };
      case "RATE_LIMITED":
        return { state: "error", message: "Jira API 요청 한도를 초과했습니다." };
      case "CREDENTIAL_ERROR":
      case "HTTP_ERROR":
      case "MALFORMED_RESPONSE":
      case "NETWORK_ERROR":
        return { state: "error", message: error.message };
    }
  }
  return { state: "error", message: "Jira 연결 상태를 확인하지 못했습니다." };
}

function malformedCredential(): JiraPluginError {
  return new JiraPluginError(
    JIRA_ERROR_CODES.malformedCredential,
    "Jira credential 형식이 유효하지 않습니다.",
  );
}

function malformedResponse(message: string): JiraPluginError {
  return new JiraPluginError(JIRA_ERROR_CODES.malformedResponse, message);
}

function invalidInput(message: string): JiraPluginError {
  return new JiraPluginError(JIRA_ERROR_CODES.invalidInput, message);
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

const defaultJiraFetch: JiraFetch = (input, init) => globalThis.fetch(input, init);
