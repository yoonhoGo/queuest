#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const resourceArgument = process.argv.indexOf("--resource");
const resource = resourceArgument >= 0 ? process.argv[resourceArgument + 1] : "unknown";
const logPath = process.env.QUEUEST_EVENTKIT_MOCK_LOG;

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeResponse({ id: "unknown" }, undefined, {
      code: "INVALID_JSON",
      message: "eventkit mock received invalid JSON",
    });
    return;
  }

  record(request.method);
  if (request.method === "initialize") {
    writeResponse(request, { initialized: true, mode: "mock-no-tcc" });
    return;
  }

  if (request.method === "health.check") {
    writeResponse(request, {
      state: "connected",
      accountLabel: resource === "calendar" ? "Mock Apple Calendar" : "Mock Apple Reminders",
    });
    return;
  }

  if (request.method === "shutdown") {
    writeResponse(request, { shutdown: true }, undefined, () => {
      input.close();
      process.exit(0);
    });
    return;
  }

  writeResponse(request, undefined, {
    code: "UNSUPPORTED_METHOD",
    message: `eventkit mock does not implement ${request.method}`,
  });
});

function record(method) {
  if (!logPath) {
    return;
  }
  appendFileSync(logPath, `${JSON.stringify({ resource, method, mode: "mock-no-tcc" })}\n`);
}

function writeResponse(request, result, error, onWritten) {
  const response = {
    protocolVersion: 1,
    id: request.id,
    ...(error ? { error } : { result }),
  };
  process.stdout.write(`${JSON.stringify(response)}\n`, onWritten);
}
