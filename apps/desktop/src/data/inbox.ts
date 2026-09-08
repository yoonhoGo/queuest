import { createSqliteTaskRepository } from "@queuest/adapter-sqlite";
import type { EntityId, InboxTodo } from "@queuest/domain";
import type { InboxTodoRepository } from "@queuest/ports";

let repositoryPromise: Promise<InboxTodoRepository> | undefined;

/**
 * Keep the SQLite connection behind a small UI-facing bridge. Initializing the
 * repository creates the schema, but this bridge only touches inbox todos; the
 * project graph is intentionally not loaded during app startup.
 */
export function getInboxTodoRepository(): Promise<InboxTodoRepository> {
  if (!repositoryPromise) {
    const nextRepository = createSqliteTaskRepository();
    repositoryPromise = nextRepository.catch((error: unknown) => {
      repositoryPromise = undefined;
      throw error;
    });
  }

  return repositoryPromise;
}

export async function loadInboxTodos(): Promise<InboxTodo[]> {
  return (await getInboxTodoRepository()).listInboxTodos();
}

export async function saveInboxTodo(todo: InboxTodo): Promise<void> {
  const repository = await getInboxTodoRepository();
  await repository.saveInboxTodo(todo);
}

export async function deleteInboxTodo(todoId: EntityId): Promise<void> {
  const repository = await getInboxTodoRepository();
  await repository.deleteInboxTodo(todoId);
}
