import { invoke } from "@tauri-apps/api/core";
import type { EntityId, Project, Task } from "@queuest/domain";
import type { AgentRunInput, AgentRunResult, AgentRunner } from "@queuest/ports";

interface TauriAgentRunResult {
  summary: string;
  raw_output?: string;
}

export class ClaudeAgentRunner implements AgentRunner {
  public async run(input: AgentRunInput): Promise<AgentRunResult> {
    if (!input.project.repoPath) {
      throw new Error("AI 실행에는 프로젝트 repoPath가 필요합니다.");
    }

    const result = await invoke<TauriAgentRunResult>("run_agent", {
      taskId: input.task.id,
      repoPath: input.project.repoPath,
      prompt: `${input.task.title}\n\n${input.task.body}`,
    });

    return {
      summary: result.summary,
      ...(result.raw_output ? { rawOutput: result.raw_output } : {}),
    };
  }

  public async cancel(taskId: EntityId): Promise<void> {
    await invoke("cancel_agent", { taskId });
  }
}

export function agentInput(task: Task, project: Project): AgentRunInput {
  return { task, project };
}
