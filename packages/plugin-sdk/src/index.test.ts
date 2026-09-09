import assert from "node:assert/strict";
import test from "node:test";
import { dispatchPluginRequest, PluginProtocolError } from "./index.ts";

test("dispatches a supported capability to the plugin handler", async () => {
  const response = await dispatchPluginRequest(
    {
      protocolVersion: 1,
      id: "request-1",
      method: "source.work-items.list",
      params: { connectionId: "connection-1" },
    },
    {
      listWorkItems: async (params) => ({
        items: [{ externalId: params.connectionId, title: "첫 외부 항목" }],
      }),
    },
  );

  assert.deepEqual(response, {
    protocolVersion: 1,
    id: "request-1",
    result: {
      items: [{ externalId: "connection-1", title: "첫 외부 항목" }],
    },
  });
});

test("returns a protocol error when a capability is not implemented", async () => {
  const response = await dispatchPluginRequest(
    {
      protocolVersion: 1,
      id: "request-2",
      method: "source.calendar-events.list",
      params: {},
    },
    {},
  );

  assert.deepEqual(response, {
    protocolVersion: 1,
    id: "request-2",
    error: {
      code: "PLUGIN_ERROR",
      message: "플러그인이 source.calendar-events.list capability를 구현하지 않았습니다.",
    },
  });
});

test("rejects results that cannot cross the JSON protocol", async () => {
  const response = await dispatchPluginRequest(
    {
      protocolVersion: 1,
      id: "request-3",
      method: "health.check",
      params: {},
    },
    {
      healthCheck: () => ({ invalid: undefined }),
    },
  );

  assert.deepEqual(response, {
    protocolVersion: 1,
    id: "request-3",
    error: {
      code: "INVALID_RESULT",
      message: "플러그인 결과가 JSON 값이 아닙니다.",
    },
  });
});

test("preserves explicitly safe typed protocol errors", async () => {
  const response = await dispatchPluginRequest(
    {
      protocolVersion: 1,
      id: "request-4",
      method: "tcc.status",
      params: {},
    },
    {
      tccStatus: () => {
        throw new PluginProtocolError("TCC_DENIED", "Apple Calendar 접근이 거부되었습니다.", {
          resource: "calendar",
        });
      },
    },
  );

  assert.deepEqual(response, {
    protocolVersion: 1,
    id: "request-4",
    error: {
      code: "TCC_DENIED",
      message: "Apple Calendar 접근이 거부되었습니다.",
      details: { resource: "calendar" },
    },
  });
});
