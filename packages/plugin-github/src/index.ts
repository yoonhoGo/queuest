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

export const GITHUB_PLUGIN_ID = "com.queuest.github" as const;
export const GITHUB_PROVIDER_ID = "github" as const;
export const GITHUB_API_BASE_URL = "https://api.github.com" as const;
export const GITHUB_API_BASE = GITHUB_API_BASE_URL;
export const GITHUB_API_VERSION = "2022-11-28" as const;
export const GITHUB_ACCEPT_HEADER = "application/vnd.github+json" as const;
export const GITHUB_NETWORK_PERMISSION = "api.github.com" as const;
export const GITHUB_SECRET_PERMISSION = "github" as const;
export const GITHUB_PAGE_SIZE = 100 as const;

const MAX_SAFE_PAGE = Number.MAX_SAFE_INTEGER;

export const GITHUB_ERROR_CODES = {
  permissionDenied: "PERMISSION_DENIED",
  invalidInput: "INVALID_INPUT",
  credentialNotFound: "CREDENTIAL_NOT_FOUND",
  credentialError: "CREDENTIAL_ERROR",
  auth: "AUTH_ERROR",
  notFound: "NOT_FOUND",
  rateLimit: "RATE_LIMITED",
  http: "HTTP_ERROR",
  malformedResponse: "MALFORMED_RESPONSE",
  network: "NETWORK_ERROR",
  notInitialized: "NOT_INITIALIZED",
} as const;

export type GithubPluginErrorCode = (typeof GITHUB_ERROR_CODES)[keyof typeof GITHUB_ERROR_CODES];

/** Safe, provider-specific failures. Its messages never contain credentials. */
export class GithubPluginError extends Error {
  public readonly code: GithubPluginErrorCode;
  public readonly status?: number;

  public constructor(
    code: GithubPluginErrorCode,
    message: string,
    options?: { status?: number },
  ) {
    super(message);
    this.code = code;
    this.status = options?.status;
    this.name = "GithubPluginError";
  }
}

export interface GithubFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface GithubRestClientOptions {
  fetch?: GithubFetch;
  credentialStore?: CredentialStore;
  grantedPermissions?: PluginPermissions;
  /** Alias useful to callers that name the initialize grant simply permissions. */
  permissions?: PluginPermissions;
}

export interface GithubPluginHandlersOptions extends GithubRestClientOptions {
  client?: GithubRestClient;
}

interface GithubIssueResponse {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  html_url?: unknown;
  url?: unknown;
  updated_at?: unknown;
  labels?: unknown;
  pull_request?: unknown;
}

interface GithubJsonResponse {
  response: Response;
  body: unknown;
}

/**
 * Small GitHub REST client. The base URL is deliberately not configurable:
 * provider input can only select an owner/repository and a numeric page.
 */
export class GithubRestClient {
  private readonly fetcher: GithubFetch;
  private readonly credentialStore: CredentialStore;
  private grantedPermissions: PluginPermissions;

  public constructor(options?: GithubRestClientOptions);
  public constructor(
    fetcher: GithubFetch,
    credentialStore?: CredentialStore,
    grantedPermissions?: PluginPermissions,
  );
  public constructor(
    optionsOrFetcher: GithubRestClientOptions | GithubFetch = {},
    credentialStore?: CredentialStore,
    grantedPermissions?: PluginPermissions,
  ) {
    if (typeof optionsOrFetcher === "function") {
      this.fetcher = optionsOrFetcher;
      this.credentialStore = credentialStore ?? new MacOSKeychainCredentialStore();
      this.grantedPermissions = clonePermissions(grantedPermissions ?? {});
      return;
    }

    this.fetcher = optionsOrFetcher.fetch ?? defaultGithubFetch;
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
      throw new GithubPluginError(
        GITHUB_ERROR_CODES.permissionDenied,
        "GitHub 플러그인 권한이 유효하지 않습니다.",
      );
    }

    const hasNetworkPermission = normalized.network?.includes(GITHUB_NETWORK_PERMISSION) ?? false;
    const hasSecretPermission = normalized.secrets?.includes(GITHUB_SECRET_PERMISSION) ?? false;
    if (!hasNetworkPermission || !hasSecretPermission) {
      throw new GithubPluginError(
        GITHUB_ERROR_CODES.permissionDenied,
        "GitHub 플러그인의 API 및 credential 권한 승인이 필요합니다.",
      );
    }
  }

  public async listWorkItems(query: WorkItemQuery): Promise<Page<ExternalWorkItem>> {
    const connectionId = requireConnectionId(query.connectionId);
    const { owner, repository } = parseRepository(query.repository);
    const page = parsePageCursor(query.cursor);
    const token = await this.readToken(connectionId);
    const path = buildIssuesPath(owner, repository, page);
    const { body, response } = await this.requestJson(path, token);
    if (!Array.isArray(body)) {
      throw malformedResponse("GitHub issues 응답이 배열이 아닙니다.");
    }

    const items: ExternalWorkItem[] = [];
    for (const value of body) {
      if (!isRecord(value)) {
        throw malformedResponse("GitHub issues 응답 항목이 객체가 아닙니다.");
      }
      // GitHub's issues endpoint includes pull requests. Presence of this
      // field is the documented discriminator and must be filtered first.
      if (Object.prototype.hasOwnProperty.call(value, "pull_request")) {
        continue;
      }
      items.push(mapIssue(value, connectionId, owner, repository));
    }

    const nextCursor = nextPageCursor(response, page, body.length);
    return nextCursor === undefined ? { items } : { items, nextCursor };
  }

  public async listIssues(query: WorkItemQuery): Promise<Page<ExternalWorkItem>> {
    return this.listWorkItems(query);
  }

  public async connectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      const normalizedConnectionId = requireConnectionId(connectionId);
      const token = await this.readToken(normalizedConnectionId);
      const { body } = await this.requestJson("/user", token);
      if (!isRecord(body)) {
        throw malformedResponse("GitHub 사용자 응답이 객체가 아닙니다.");
      }
      const login = body.login;
      if (typeof login !== "string" || login.length === 0) {
        throw malformedResponse("GitHub 사용자 응답의 login이 유효하지 않습니다.");
      }
      return {
        state: "connected",
        accountLabel: login,
      };
    } catch (error: unknown) {
      return connectionStatusForError(error);
    }
  }

  public async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    return this.connectionStatus(connectionId);
  }

  public healthCheck(): ConnectionStatus {
    try {
      this.assertApprovedPermissions();
      return { state: "connected" };
    } catch (error: unknown) {
      return connectionStatusForError(error);
    }
  }

  private async readToken(connectionId: string): Promise<string> {
    this.assertApprovedPermissions();
    try {
      const token = await this.credentialStore.get(GITHUB_PLUGIN_ID, connectionId);
      if (typeof token !== "string" || token.trim().length === 0) {
        throw new GithubPluginError(
          GITHUB_ERROR_CODES.credentialNotFound,
          "GitHub credential을 찾지 못했습니다.",
        );
      }
      return token.trim();
    } catch (error: unknown) {
      if (error instanceof GithubPluginError) {
        throw error;
      }
      if (error instanceof CredentialStoreError && error.code === "CREDENTIAL_NOT_FOUND") {
        throw new GithubPluginError(
          GITHUB_ERROR_CODES.credentialNotFound,
          "GitHub credential을 찾지 못했습니다.",
        );
      }
      // Never forward an arbitrary credential-store message: it might carry
      // command diagnostics or an accidental secret value.
      throw new GithubPluginError(
        GITHUB_ERROR_CODES.credentialError,
        "GitHub credential을 읽지 못했습니다.",
      );
    }
  }

  private async requestJson(path: string, token: string): Promise<GithubJsonResponse> {
    const url = buildApiUrl(path);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: {
          Accept: GITHUB_ACCEPT_HEADER,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": "Queuest GitHub Plugin/0.1.0",
        },
      });
    } catch {
      throw new GithubPluginError(
        GITHUB_ERROR_CODES.network,
        "GitHub API 요청에 실패했습니다.",
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
      throw malformedResponse("GitHub API 응답 JSON을 읽지 못했습니다.");
    }
    return { response, body };
  }
}

/** Alias with the provider's conventional capitalisation. */
export {
  GithubRestClient as GitHubRestClient,
  GithubRestClient as GitHubApiClient,
  GithubRestClient as GithubApiClient,
  GithubPluginError as GitHubPluginError,
};

export function createGithubPluginHandlers(options: GithubPluginHandlersOptions = {}): PluginHandlers {
  const client = options.client ?? new GithubRestClient(options);
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
    healthCheck: () => initialized ? client.healthCheck() : {
      state: "error",
      message: "GitHub 플러그인이 초기화되지 않았습니다.",
    },
    connectionStatus: async (params) => {
      if (!initialized) {
        return { state: "error", message: "GitHub 플러그인이 초기화되지 않았습니다." };
      }
      return client.connectionStatus(requireConnectionId(params.connectionId));
    },
    listWorkItems: async (params) => {
      if (!initialized) {
        throw new GithubPluginError(
          GITHUB_ERROR_CODES.notInitialized,
          "GitHub 플러그인이 초기화되지 않았습니다.",
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

export const createGitHubPluginHandlers = createGithubPluginHandlers;
export const createGithubHandlers = createGithubPluginHandlers;
export const createGitHubHandlers = createGithubPluginHandlers;
export const createHandlers = createGithubPluginHandlers;

function parseGrantedPermissions(value: unknown): PluginPermissions {
  if (!isRecord(value)) {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.permissionDenied,
      "GitHub 플러그인 권한 승인이 필요합니다.",
    );
  }
  try {
    return normalizePermissions(value as PluginPermissions);
  } catch {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.permissionDenied,
      "GitHub 플러그인 권한이 유효하지 않습니다.",
    );
  }
}

function parseWorkItemQuery(params: JsonObject): WorkItemQuery {
  const connectionId = requireConnectionId(params.connectionId);
  if (typeof params.repository !== "string") {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub repository는 owner/repository 형식이어야 합니다.",
    );
  }
  const cursor = params.cursor;
  if (cursor !== undefined && cursor !== null && typeof cursor !== "string") {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub page cursor는 숫자 문자열이어야 합니다.",
    );
  }
  return {
    connectionId,
    repository: params.repository,
    ...(typeof cursor === "string" ? { cursor } : {}),
  };
}

function requireConnectionId(value: unknown): string {
  if (typeof value !== "string") {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub connectionId가 필요합니다.",
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub connectionId가 유효하지 않습니다.",
    );
  }
  return normalized;
}

function parseRepository(value: unknown): { owner: string; repository: string } {
  if (typeof value !== "string") {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub repository는 owner/repository 형식이어야 합니다.",
    );
  }
  const match = value.trim().match(/^([^/]+)\/([^/]+)$/);
  if (!match || !isGithubName(match[1]) || !isGithubName(match[2])) {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub repository는 owner/repository 형식이어야 합니다.",
    );
  }
  return { owner: match[1], repository: match[2] };
}

function isGithubName(value: string): boolean {
  return value !== "." && value !== ".." && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value);
}

function parsePageCursor(value: unknown): number {
  if (value === undefined || value === null) {
    return 1;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub page cursor는 양의 정수 문자열이어야 합니다.",
    );
  }
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub page cursor는 양의 정수 문자열이어야 합니다.",
    );
  }
  return page;
}

function mapIssue(
  value: Record<string, unknown>,
  connectionId: string,
  owner: string,
  repository: string,
): ExternalWorkItem {
  const issue = value as GithubIssueResponse;
  const number = parsePositiveInteger(issue.number, "number");
  const externalId = issue.id === undefined
    ? String(number)
    : String(parsePositiveInteger(issue.id, "id"));
  const title = requiredText(issue.title, "title");
  const sourceUrl = requiredText(issue.html_url ?? issue.url, "html_url");
  const state = typeof issue.state === "string" ? issue.state.toLowerCase() : issue.state;
  if (state !== "open" && state !== "closed") {
    throw malformedResponse("GitHub issue state가 유효하지 않습니다.");
  }
  const body = issue.body === undefined || issue.body === null
    ? ""
    : requiredText(issue.body, "body");
  const labels = mapLabels(issue.labels);
  const updatedAt = issue.updated_at;
  if (updatedAt !== undefined && updatedAt !== null && typeof updatedAt !== "string") {
    throw malformedResponse("GitHub issue updated_at이 유효하지 않습니다.");
  }

  return {
    providerId: GITHUB_PROVIDER_ID,
    connectionId,
    externalId,
    externalRef: `github:${owner}/${repository}#${number}`,
    sourceUrl,
    title,
    body,
    status: state === "closed" ? "closed" : "open",
    labels,
    ...(typeof updatedAt === "string" && updatedAt.length > 0 ? { updatedAt } : {}),
  };
}

function mapLabels(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw malformedResponse("GitHub issue labels가 배열이 아닙니다.");
  }
  return value.map((label) => {
    if (!isRecord(label) || typeof label.name !== "string") {
      throw malformedResponse("GitHub issue label 이름이 유효하지 않습니다.");
    }
    return label.name;
  });
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw malformedResponse(`GitHub issue ${field}가 유효하지 않습니다.`);
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw malformedResponse(`GitHub issue ${field}가 유효하지 않습니다.`);
  }
  return value;
}

function nextPageCursor(
  response: Response,
  currentPage: number,
  rawItemCount: number,
): string | undefined {
  const link = responseHeader(response, "link");
  if (link !== undefined) {
    const nextLink = [...link.matchAll(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/gi)][0]?.[1];
    if (nextLink === undefined) {
      return undefined;
    }
    try {
      const nextUrl = new URL(nextLink, GITHUB_API_BASE_URL);
      if (nextUrl.origin !== GITHUB_API_BASE_URL) {
        return undefined;
      }
      const pageValue = nextUrl.searchParams.get("page");
      if (pageValue === null) {
        return undefined;
      }
      return String(parsePageCursor(pageValue));
    } catch {
      return undefined;
    }
  }

  if (rawItemCount < GITHUB_PAGE_SIZE || currentPage >= MAX_SAFE_PAGE) {
    return undefined;
  }
  return String(currentPage + 1);
}

function buildIssuesPath(owner: string, repository: string, page: number): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues?state=all&per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
}

function buildApiUrl(path: string): string {
  // Callers pass only constants assembled by this module. Requiring a rooted
  // path prevents accidental host replacement if a future path is refactored.
  if (!path.startsWith("/")) {
    throw new GithubPluginError(
      GITHUB_ERROR_CODES.invalidInput,
      "GitHub API 경로가 유효하지 않습니다.",
    );
  }
  return `${GITHUB_API_BASE_URL}${path}`;
}

function classifyHttpError(response: Response, status: number | undefined): GithubPluginError {
  const numericStatus = status ?? 0;
  if (numericStatus === 401) {
    return new GithubPluginError(
      GITHUB_ERROR_CODES.auth,
      "GitHub 인증이 유효하지 않습니다.",
      { status: numericStatus },
    );
  }
  if (numericStatus === 404) {
    return new GithubPluginError(
      GITHUB_ERROR_CODES.notFound,
      "GitHub 리소스를 찾지 못했습니다.",
      { status: numericStatus },
    );
  }
  const remaining = responseHeader(response, "x-ratelimit-remaining");
  if (numericStatus === 429 || (numericStatus === 403 && remaining === "0")) {
    return new GithubPluginError(
      GITHUB_ERROR_CODES.rateLimit,
      "GitHub API 요청 한도를 초과했습니다.",
      { status: numericStatus },
    );
  }
  if (numericStatus === 403) {
    return new GithubPluginError(
      GITHUB_ERROR_CODES.auth,
      "GitHub 요청 권한이 없습니다.",
      { status: numericStatus },
    );
  }
  return new GithubPluginError(
    GITHUB_ERROR_CODES.http,
    numericStatus > 0 ? `GitHub API가 HTTP ${numericStatus} 오류를 반환했습니다.` : "GitHub API 응답이 유효하지 않습니다.",
    { status: numericStatus > 0 ? numericStatus : undefined },
  );
}

function connectionStatusForError(error: unknown): ConnectionStatus {
  if (error instanceof GithubPluginError) {
    switch (error.code) {
      case "CREDENTIAL_NOT_FOUND":
      case "AUTH_ERROR":
        return { state: "needs-auth", message: error.code === "AUTH_ERROR" ? "GitHub 인증을 확인해 주세요." : "GitHub 인증 정보가 없습니다." };
      case "PERMISSION_DENIED":
      case "INVALID_INPUT":
      case "NOT_INITIALIZED":
        return { state: "error", message: error.message };
      case "NOT_FOUND":
        return { state: "error", message: "GitHub 연결 대상을 찾지 못했습니다." };
      case "RATE_LIMITED":
        return { state: "error", message: "GitHub API 요청 한도를 초과했습니다." };
      case "CREDENTIAL_ERROR":
      case "HTTP_ERROR":
      case "MALFORMED_RESPONSE":
      case "NETWORK_ERROR":
        return { state: "error", message: error.message };
    }
  }
  return { state: "error", message: "GitHub 연결 상태를 확인하지 못했습니다." };
}

function malformedResponse(message: string): GithubPluginError {
  return new GithubPluginError(
    GITHUB_ERROR_CODES.malformedResponse,
    message,
  );
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

function clonePermissions(permissions: PluginPermissions): PluginPermissions {
  return {
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

const defaultGithubFetch: GithubFetch = (input, init) => globalThis.fetch(input, init);

// Keep the protocol version referenced in this package so the entrypoint and
// SDK stay visibly tied to the shared contract boundary.
export const GITHUB_PLUGIN_PROTOCOL_VERSION = PLUGIN_PROTOCOL_VERSION;
