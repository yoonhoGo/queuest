import type { EntityId, InboxTodo } from "@queuest/domain";
import { getRepository } from "./repository";

export async function loadInboxTodos(): Promise<InboxTodo[]> {
  return (await getRepository()).listInboxTodos();
}

export async function saveInboxTodo(todo: InboxTodo): Promise<void> {
  const repository = await getRepository();
  await repository.saveInboxTodo(todo);
}

export async function deleteInboxTodo(todoId: EntityId): Promise<void> {
  const repository = await getRepository();
  await repository.deleteInboxTodo(todoId);
}
