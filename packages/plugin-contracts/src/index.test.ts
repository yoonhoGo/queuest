import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePluginManifest,
  parsePluginRequest,
  PLUGIN_PROTOCOL_VERSION,
  type PluginManifest,
} from "./index.ts";

const validManifest: PluginManifest = {
  schemaVersion: 1,
  id: "com.example.calendar",
  name: "Example Calendar",
  version: "1.0.0",
  hostApi: "^1.0.0",
  entry: {
    type: "process",
    command: "./bin/example-calendar",
    args: ["--stdio"],
  },
  capabilities: ["source.calendar-events"],
  permissions: {
    network: ["calendar.example.com"],
    secrets: ["calendar"],
  },
};

test("validates an installable plugin manifest", () => {
  assert.deepEqual(parsePluginManifest(validManifest), validManifest);
});

test("deduplicates capabilities while preserving manifest data", () => {
  const parsed = parsePluginManifest({
    ...validManifest,
    capabilities: ["source.calendar-events", "source.calendar-events"],
  });

  assert.deepEqual(parsed.capabilities, ["source.calendar-events"]);
});

test("rejects an unsupported capability", () => {
  assert.throws(
    () => parsePluginManifest({ ...validManifest, capabilities: ["filesystem.full"] }),
    /지원하지 않는 plugin capability/,
  );
});

test("rejects an invalid permission declaration", () => {
  assert.throws(
    () =>
      parsePluginManifest({
        ...validManifest,
        permissions: { filesystem: [{ path: "/tmp", access: "execute" }] },
      }),
    /permissions\.filesystem/,
  );
});

test("parses versioned protocol requests", () => {
  assert.deepEqual(
    parsePluginRequest({
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      id: "request-1",
      method: "source.work-items.list",
      params: { connectionId: "connection-1", cursor: null },
    }),
    {
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      id: "request-1",
      method: "source.work-items.list",
      params: { connectionId: "connection-1", cursor: null },
    },
  );
});

test("rejects protocol requests from an unknown version", () => {
  assert.throws(
    () =>
      parsePluginRequest({
        protocolVersion: 2,
        id: "request-1",
        method: "health.check",
        params: {},
      }),
    /지원하지 않는 plugin protocolVersion/,
  );
});
