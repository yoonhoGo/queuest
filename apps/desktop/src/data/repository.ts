import { createSqliteTaskRepository } from "@queuest/adapter-sqlite";
import type { QueuestRepository } from "@queuest/ports";

let repositoryPromise: Promise<QueuestRepository> | undefined;

/**
 * Keep the SQLite connection behind one UI-facing bridge. The repository
 * initializes the schema once, while callers decide which data to load.
 */
export function getRepository(): Promise<QueuestRepository> {
  if (!repositoryPromise) {
    const nextRepository = createSqliteTaskRepository();
    repositoryPromise = nextRepository.catch((error: unknown) => {
      repositoryPromise = undefined;
      throw error;
    });
  }

  return repositoryPromise;
}
