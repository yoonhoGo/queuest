import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });

input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeResponse({ id: "unknown" }, undefined, {
      code: "INVALID_JSON",
      message: "mock plugin received invalid JSON",
    });
    return;
  }

  process.stderr.write(`mock-plugin:${request.method}\n`);
  if (request.method === "initialize") {
    process.stderr.write(
      `mock-plugin:initialize-granted:${JSON.stringify(request.params?.grantedPermissions ?? {})}\n`,
    );
    writeResponse(request, {
      initialized: true,
      appId: request.params?.host?.appId,
      grantedPermissions: request.params?.grantedPermissions ?? {},
    });
    return;
  }

  if (request.method === "health.check") {
    const delayMs =
      typeof request.params?.delayMs === "number" && request.params.delayMs >= 0
        ? request.params.delayMs
        : 0;
    setTimeout(() => {
      writeResponse(request, {
        state: "connected",
        label: request.params?.label ?? null,
      });
    }, delayMs);
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
    message: `mock plugin does not implement ${request.method}`,
  });
});

function writeResponse(request, result, error, onWritten) {
  const response = {
    protocolVersion: 1,
    id: request.id,
    ...(error ? { error } : { result }),
  };
  process.stdout.write(`${JSON.stringify(response)}\n`, onWritten);
}
