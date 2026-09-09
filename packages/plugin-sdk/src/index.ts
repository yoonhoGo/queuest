import { createInterface } from "node:readline";
import {
  isJsonValue,
  parsePluginRequest,
  PLUGIN_PROTOCOL_VERSION,
  type JsonObject,
  type PluginErrorResponse,
  type PluginRequest,
  type PluginResponse,
  type PluginSuccessResponse,
} from "@queuest/plugin-contracts";

export interface PluginHandlers {
  initialize?: (params: JsonObject) => unknown | Promise<unknown>;
  healthCheck?: (params: JsonObject) => unknown | Promise<unknown>;
  connectionStatus?: (params: JsonObject) => unknown | Promise<unknown>;
  tccStatus?: (params: JsonObject) => unknown | Promise<unknown>;
  requestTccAccess?: (params: JsonObject) => unknown | Promise<unknown>;
  listWorkItems?: (params: JsonObject) => unknown | Promise<unknown>;
  listCalendarEvents?: (params: JsonObject) => unknown | Promise<unknown>;
  shutdown?: (params: JsonObject) => unknown | Promise<unknown>;
}

export async function dispatchPluginRequest(
  request: PluginRequest,
  handlers: PluginHandlers,
): Promise<PluginResponse> {
  try {
    const result = await callHandler(request, handlers);
    if (!isJsonValue(result)) {
      return errorResponse(request.id, "INVALID_RESULT", "플러그인 결과가 JSON 값이 아닙니다.");
    }

    return successResponse(request.id, result);
  } catch (error: unknown) {
    if (error instanceof PluginProtocolError) {
      return errorResponse(request.id, error.code, error.message, error.details);
    }
    return errorResponse(request.id, "PLUGIN_ERROR", readableError(error));
  }
}

export function servePlugin(handlers: PluginHandlers): void {
  const input = createInterface({ input: process.stdin });
  let chain = Promise.resolve();

  input.on("line", (line) => {
    chain = chain.then(async () => {
      const response = await dispatchPluginLine(line, handlers);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  });
}

async function dispatchPluginLine(line: string, handlers: PluginHandlers): Promise<PluginResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return errorResponse("unknown", "INVALID_JSON", "플러그인 요청이 유효한 JSON이 아닙니다.");
  }

  try {
    return await dispatchPluginRequest(parsePluginRequest(parsed), handlers);
  } catch (error: unknown) {
    return errorResponse("unknown", "INVALID_REQUEST", readableError(error));
  }
}

async function callHandler(request: PluginRequest, handlers: PluginHandlers): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return handlers.initialize
        ? handlers.initialize(request.params)
        : {};
    case "health.check":
      return handlers.healthCheck
        ? handlers.healthCheck(request.params)
        : { state: "connected" };
    case "connection.status":
      return requireHandler(handlers.connectionStatus, "connection.status")(request.params);
    case "tcc.status":
      return requireHandler(handlers.tccStatus, "tcc.status")(request.params);
    case "tcc.request-access":
      return requireHandler(handlers.requestTccAccess, "tcc.request-access")(request.params);
    case "source.work-items.list":
      return requireHandler(handlers.listWorkItems, "source.work-items.list")(request.params);
    case "source.calendar-events.list":
      return requireHandler(handlers.listCalendarEvents, "source.calendar-events.list")(request.params);
    case "shutdown":
      return handlers.shutdown
        ? handlers.shutdown(request.params)
        : {};
  }
}

function requireHandler(
  handler: ((params: JsonObject) => unknown | Promise<unknown>) | undefined,
  method: string,
): (params: JsonObject) => unknown | Promise<unknown> {
  if (!handler) {
    throw new Error(`플러그인이 ${method} capability를 구현하지 않았습니다.`);
  }

  return handler;
}

function successResponse(id: string, result: import("@queuest/plugin-contracts").JsonValue): PluginSuccessResponse {
  return {
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    id,
    result,
  };
}

function errorResponse(
  id: string,
  code: string,
  message: string,
  details?: import("@queuest/plugin-contracts").JsonValue,
): PluginErrorResponse {
  return {
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    id,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

/** An explicitly sanitized error allowed to cross the plugin protocol. */
export class PluginProtocolError extends Error {
  public readonly code: string;
  public readonly details?: import("@queuest/plugin-contracts").JsonValue;

  public constructor(
    code: string,
    message: string,
    details?: import("@queuest/plugin-contracts").JsonValue,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "PluginProtocolError";
  }
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "플러그인 실행 중 알 수 없는 오류가 발생했습니다.";
}
