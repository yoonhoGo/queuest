import assert from "node:assert/strict";
import test from "node:test";
import type { PluginConnection, ProjectGraph, Task } from "@queuest/domain";
import { syncConnections, type SyncStore, type RemoteTask } from "./external-sync-core.ts";
const connection = (id: string): PluginConnection => ({ pluginId: "com.queuest.jira", connectionId: id, label: id, config: {}, credentialStored: true, updatedAt: "1" });
const remote = (ref: string): RemoteTask => ({ title: ref, body: "", externalRef: ref, status: "done", assignee: "human", blocked: false, skills: [] });
function fixture(connections = [connection("a")]) {
  const graphs: ProjectGraph[] = [];
  const tasks: Task[] = [];
  const store: SyncStore = {
    async listPluginConnections() { return connections; },
    async listProjectGraphs() { return graphs.map(g => ({ ...g, tasks: tasks.filter(t => g.milestones.some(m => m.id === t.milestoneId)) })); },
    async saveWorkspace() {},
    async saveProject(project) { graphs.push({ project, workspace: { id: project.workspaceId, name: "w" }, milestones: [], tasks: [] }); },
    async saveMilestone(m) { graphs.find(g => g.project.id === m.projectId)!.milestones.push(m); },
    async saveTask(task) { tasks.push(task); },
  };
  return { store, graphs, tasks, connections };
}
test("paginated imports deduplicate pages, subsequent runs and connections, without overwriting human edits", async () => {
  const f = fixture([connection("a"), connection("b")]);
  const fetch = async (_: PluginConnection, cursor?: string) => ({ items: cursor ? [remote("one"), remote("two")] : [remote("one"), remote("one")], nextCursor: cursor ? null : "2" });
  assert.equal((await syncConnections(f.store, fetch)).added, 2);
  assert.equal(f.tasks[0].status, "review");
  f.tasks[0].title = "my edit"; f.tasks[0].status = "done";
  assert.equal((await syncConnections(f.store, fetch)).added, 0);
  assert.equal(f.tasks[0].title, "my edit"); assert.equal(f.tasks[0].status, "done");
  assert.equal(f.graphs.length, 1);
});
test("failure of one connection does not stop another and errors redact remote content", async () => {
  const f = fixture([connection("a"), connection("b")]);
  const result = await syncConnections(f.store, async c => { if (c.connectionId === "a") throw Error("secret-token"); return { items: [remote("b")], nextCursor: null }; });
  assert.equal(result.added, 1); assert.equal(result.errors.length, 1); assert.ok(!result.errors[0].includes("secret-token"));
});
test("deleted or edited connection cannot commit an in-flight result", async () => {
  for (const action of ["delete", "edit"]) {
    const f = fixture();
    await syncConnections(f.store, async () => { if (action === "delete") f.connections.splice(0); else f.connections[0] = { ...f.connections[0], updatedAt: "2" }; return { items: [remote("one")], nextCursor: null }; });
    assert.equal(f.tasks.length, 0);
  }
});
test("repeated cursor stops and pending backlog remains pending", async () => {
  const f = fixture(); let calls = 0;
  const result = await syncConnections(f.store, async () => { calls++; return { items: [{ ...remote("one"), status: "todo", quest: { acceptance: "pending" } } as RemoteTask], nextCursor: "same" }; });
  assert.equal(calls, 2); assert.equal(result.errors.length, 1); assert.equal(f.tasks[0].quest?.acceptance, "pending");
});
test("connections without credentials are not queried", async () => {
  const f = fixture([{ ...connection("a"), credentialStored: false }]);
  let called = false;
  const result = await syncConnections(f.store, async () => { called = true; return { items: [], nextCursor: null }; });
  assert.equal(called, false); assert.equal(result.errors.length, 1);
});
