import { randomUUID } from "node:crypto";
import { spawn as spawnProcess } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  isJsonValue,
  PLUGIN_PROTOCOL_VERSION,
  type JsonObject,
  type JsonValue,
  type PluginMethod,
  type PluginResponse,
} from "@queuest/plugin-contracts";

export interface PluginProcess {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type PluginSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => PluginProcess;

export interface PluginLogger {
  debug?(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export type PluginTransportStatus = "idle" | "running" | "stopping" | "stopped" | "failed";

export type PluginTransportEvent =
  | { type: "stderr"; message: string }
  | { type: "malformed-response"; line: string; error: PluginTransportError }
  | { type: "unmatched-response"; id: string }
  | { type: "process-error"; error: PluginTransportError }
  | { type: "process-exit"; code: number | null; signal: NodeJS.Signals | null };

export interface PluginTransportOptions {
  command: string;
  args?: readonly string[];
  cwd: string;
  pluginId?: string;
  timeoutMs?: number;
  shutdownTimeoutMs?: number;
  spawnProcess?: PluginSpawn;
  /** Alias useful when adapting a host's existing process abstraction. */
  spawn?: PluginSpawn;
  requestId?: () => string;
  logger?: PluginLogger;
  onEvent?: (event: PluginTransportEvent) => void;
}

export interface PluginRequestOptions {
  timeoutMs?: number;
  requestId?: string;
}

export class PluginTransportError extends Error {
  public readonly code: string;
  public readonly requestId?: string;

  public constructor(
    code: string,
    message: string,
    requestId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.requestId = requestId;
    this.name = "PluginTransportError";
  }
}

/**
 * A line-delimited JSON client for one external plugin process. Requests are
 * kept in a pending map until a response with the same id arrives, exits, or
 * reaches its timeout; malformed and unmatched lines never crash the host.
 */
export class PluginTransport {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly cwd: string;
  private readonly pluginId: string;
  private readonly timeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly spawn: PluginSpawn;
  private readonly requestIdFactory: () => string;
  private readonly logger: PluginLogger;
  private readonly onEvent?: (event: PluginTransportEvent) => void;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly terminationWaiters = new Set<() => void>();
  private statusValue: PluginTransportStatus = "idle";
  private child?: PluginProcess;
  private stdoutReader?: Interface;
  private terminationHandled = false;
  private shutdownPromise?: Promise<void>;

  public constructor(options: PluginTransportOptions) {
    this.command = options.command;
    this.args = options.args ? [...options.args] : [];
    this.cwd = options.cwd;
    this.pluginId = options.pluginId ?? "unknown";
    this.timeoutMs = positiveDuration(options.timeoutMs, 10_000);
    this.shutdownTimeoutMs = positiveDuration(options.shutdownTimeoutMs, 2_000);
    this.spawn = options.spawnProcess ?? options.spawn ?? defaultSpawn;
    this.requestIdFactory = options.requestId ?? randomUUID;
    this.logger = options.logger ?? console;
    this.onEvent = options.onEvent;
  }

  public get status(): PluginTransportStatus {
    return this.statusValue;
  }

  public get process(): PluginProcess | undefined {
    return this.child;
  }

  public async start(): Promise<void> {
    if (this.statusValue === "running") {
      return;
    }
    if (this.statusValue !== "idle") {
      throw new PluginTransportError(
        "PROCESS_NOT_RUNNING",
        `플러그인 프로세스를 다시 시작할 수 없습니다: ${this.statusValue}`,
      );
    }

    this.terminationHandled = false;
    let child: PluginProcess;
    try {
      child = this.spawn(this.command, this.args, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      this.statusValue = "failed";
      throw new PluginTransportError(
        "PROCESS_SPAWN_FAILED",
        `플러그인 프로세스를 시작하지 못했습니다: ${readableError(error)}`,
        undefined,
        { cause: error },
      );
    }

    this.child = child;
    if (!child.stdin || !child.stdout) {
      this.statusValue = "failed";
      try {
        child.kill();
      } catch {
        // There is no usable process handle to recover when stdio is absent.
      }
      throw new PluginTransportError(
        "PROCESS_SPAWN_FAILED",
        "플러그인 프로세스의 stdio를 열지 못했습니다.",
      );
    }

    this.statusValue = "running";
    this.attachProcess(child);
  }

  public async requestResponse(
    method: PluginMethod,
    params: JsonObject,
    options: PluginRequestOptions = {},
  ): Promise<PluginResponse> {
    await this.start();
    const child = this.child;
    const shutdownWhileStopping = method === "shutdown" && this.statusValue === "stopping";
    if (
      (!shutdownWhileStopping && this.statusValue !== "running") ||
      !child?.stdin ||
      child.stdin.writable === false
    ) {
      throw new PluginTransportError(
        "PROCESS_NOT_RUNNING",
        `플러그인 프로세스가 실행 중이 아닙니다: ${this.statusValue}`,
      );
    }

    const id = this.nextRequestId(options.requestId);
    const request = {
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      id,
      method,
      params,
    };
    const timeoutMs = positiveDuration(options.timeoutMs, this.timeoutMs);

    return new Promise<PluginResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) {
          return;
        }
        reject(
          new PluginTransportError(
            "REQUEST_TIMEOUT",
            `플러그인 요청이 ${timeoutMs}ms 안에 응답하지 않았습니다.`,
            id,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });

      try {
        child.stdin?.write(`${JSON.stringify(request)}\n`);
      } catch (error: unknown) {
        this.rejectPending(
          id,
          new PluginTransportError(
            "WRITE_FAILED",
            `플러그인 요청을 쓰지 못했습니다: ${readableError(error)}`,
            id,
            { cause: error },
          ),
        );
      }
    });
  }

  public async request<T extends JsonValue = JsonValue>(
    method: PluginMethod,
    params: JsonObject,
    options: PluginRequestOptions = {},
  ): Promise<T> {
    const response = await this.requestResponse(method, params, options);
    if ("error" in response) {
      throw new PluginTransportError(
        response.error.code,
        response.error.message,
        response.id,
        response.error.details === undefined ? undefined : { cause: response.error.details },
      );
    }
    return response.result as T;
  }

  /** Send shutdown, close stdin, and kill only if the process does not exit. */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    if (!this.child || this.statusValue === "idle" || this.terminationHandled) {
      this.statusValue = this.statusValue === "idle" ? "stopped" : this.statusValue;
      return Promise.resolve();
    }

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  public close(): Promise<void> {
    return this.shutdown();
  }

  private async performShutdown(): Promise<void> {
    const child = this.child;
    if (!child || this.terminationHandled) {
      return;
    }

    let shutdownResponse: Promise<PluginResponse> | undefined;
    if (this.statusValue === "running") {
      shutdownResponse = this.requestResponse("shutdown", {});
      this.statusValue = "stopping";
    }

    if (shutdownResponse) {
      try {
        await withTimeout(shutdownResponse, this.shutdownTimeoutMs);
      } catch (error: unknown) {
        this.logWarn(`플러그인 shutdown 요청이 완료되지 않았습니다: ${readableError(error)}`);
      }
    }

    if (this.terminationHandled) {
      return;
    }

    try {
      child.stdin?.end();
    } catch (error: unknown) {
      this.logWarn(`플러그인 stdin을 닫지 못했습니다: ${readableError(error)}`);
    }

    const exited = await this.waitForTermination(this.shutdownTimeoutMs);
    if (exited || this.terminationHandled) {
      return;
    }

    try {
      child.kill();
    } catch (error: unknown) {
      this.logWarn(`플러그인 프로세스를 종료하지 못했습니다: ${readableError(error)}`);
    }
    if (!this.terminationHandled) {
      this.finalizeProcess("stopped", null, null);
    }
  }

  private attachProcess(child: PluginProcess): void {
    this.stdoutReader = createInterface({ input: child.stdout as Readable, crlfDelay: Infinity });
    this.stdoutReader.on("line", (line) => this.handleLine(line));

    child.stderr?.on("data", (chunk: unknown) => {
      const message = String(chunk).trimEnd();
      if (!message) {
        return;
      }
      this.logWarn(`[stderr] ${message}`);
      this.emit({ type: "stderr", message });
    });

    child.on("error", (error) => this.handleProcessError(error));
    child.once("exit", (code, signal) => this.finalizeProcess("stopped", code, signal));
    child.once("close", (code, signal) => this.finalizeProcess("stopped", code, signal));
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error: unknown) {
      this.handleMalformedLine(
        line,
        new PluginTransportError(
          "MALFORMED_RESPONSE",
          `플러그인 응답이 유효한 JSON이 아닙니다: ${readableError(error)}`,
        ),
      );
      return;
    }

    const responseCheck = validatePluginResponse(parsed);
    if (!responseCheck.response) {
      this.handleMalformedLine(
        line,
        new PluginTransportError("MALFORMED_RESPONSE", responseCheck.error ?? "플러그인 응답 형식이 잘못되었습니다."),
        responseCheck.id,
      );
      return;
    }

    const response = responseCheck.response;
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.logWarn(`일치하는 플러그인 요청이 없는 응답을 무시했습니다: ${response.id}`);
      this.emit({ type: "unmatched-response", id: response.id });
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    pending.resolve(response);
  }

  private handleMalformedLine(line: string, error: PluginTransportError, id?: string): void {
    if (id && this.pending.has(id)) {
      this.rejectPending(id, new PluginTransportError(error.code, error.message, id, { cause: error }));
    }
    this.logWarn(error.message);
    this.emit({ type: "malformed-response", line, error });
  }

  private handleProcessError(error: Error): void {
    const transportError = new PluginTransportError(
      "PROCESS_ERROR",
      `플러그인 프로세스 오류: ${readableError(error)}`,
      undefined,
      { cause: error },
    );
    this.logError(transportError.message);
    this.emit({ type: "process-error", error: transportError });
    this.finalizeProcess("failed", null, null, transportError);
  }

  private finalizeProcess(
    status: "stopped" | "failed",
    code: number | null,
    signal: NodeJS.Signals | null,
    processError?: PluginTransportError,
  ): void {
    if (this.terminationHandled) {
      return;
    }
    this.terminationHandled = true;
    this.statusValue = status;
    this.stdoutReader?.close();
    this.stdoutReader = undefined;

    const pendingError =
      processError ??
      new PluginTransportError(
        "PROCESS_EXITED",
        `플러그인 프로세스가 종료되었습니다 (code=${String(code)}, signal=${String(signal)}).`,
      );
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(
        new PluginTransportError(pendingError.code, pendingError.message, id, {
          cause: pendingError,
        }),
      );
    }

    for (const resolve of this.terminationWaiters) {
      resolve();
    }
    this.terminationWaiters.clear();
    this.emit({ type: "process-exit", code, signal });
  }

  private async waitForTermination(timeoutMs: number): Promise<boolean> {
    if (this.terminationHandled) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.terminationWaiters.delete(onExit);
        resolve(value);
      };
      const onExit = (): void => finish(true);
      const timer = setTimeout(() => finish(this.terminationHandled), timeoutMs);
      this.terminationWaiters.add(onExit);
      if (this.terminationHandled) {
        onExit();
      }
    });
  }

  private nextRequestId(preferred?: string): string {
    if (preferred && !this.pending.has(preferred)) {
      return preferred;
    }

    let id = preferred ?? this.requestIdFactory();
    while (this.pending.has(id)) {
      id = this.requestIdFactory();
    }
    return id;
  }

  private rejectPending(id: string, error: PluginTransportError): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private logWarn(message: string): void {
    this.logger.warn?.(`[plugin:${this.pluginId}] ${message}`);
  }

  private logError(message: string): void {
    this.logger.error?.(`[plugin:${this.pluginId}] ${message}`);
  }

  private emit(event: PluginTransportEvent): void {
    this.onEvent?.(event);
  }
}

interface PendingRequest {
  resolve: (response: PluginResponse) => void;
  reject: (error: PluginTransportError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): PluginProcess {
  return spawnProcess(command, [...args], options) as PluginProcess;
}

function validatePluginResponse(input: unknown): {
  response?: PluginResponse;
  id?: string;
  error?: string;
} {
  if (!isRecord(input)) {
    return { error: "플러그인 응답은 JSON 객체여야 합니다." };
  }

  const id = typeof input.id === "string" ? input.id : undefined;
  if (input.protocolVersion !== PLUGIN_PROTOCOL_VERSION) {
    return { id, error: `지원하지 않는 plugin protocolVersion입니다: ${String(input.protocolVersion)}` };
  }
  if (!id || !id.trim()) {
    return { error: "플러그인 응답 id가 없습니다." };
  }
  if ("result" in input && isJsonValue(input.result)) {
    return {
      response: {
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        id,
        result: input.result,
      },
    };
  }

  if (isRecord(input.error)) {
    if (
      typeof input.error.code === "string" &&
      input.error.code.trim() &&
      typeof input.error.message === "string" &&
      input.error.message.trim() &&
      (input.error.details === undefined || isJsonValue(input.error.details))
    ) {
      return {
        response: {
          protocolVersion: PLUGIN_PROTOCOL_VERSION,
          id,
          error: {
            code: input.error.code,
            message: input.error.message,
            ...(input.error.details === undefined ? {} : { details: input.error.details }),
          },
        },
      };
    }
  }

  return { id, error: "플러그인 응답은 result 또는 유효한 error를 포함해야 합니다." };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "알 수 없는 오류";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new PluginTransportError("SHUTDOWN_TIMEOUT", "플러그인 shutdown 응답 시간이 초과되었습니다.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
