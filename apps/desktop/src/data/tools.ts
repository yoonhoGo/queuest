import { invoke } from "@tauri-apps/api/core";

export type ToolId = "claude" | "gh" | "jj";

export interface ToolInfo {
  id: ToolId;
  installed: boolean;
  path?: string;
  authenticated?: boolean;
}

export interface ToolDiscovery {
  claude: ToolInfo;
  gh: ToolInfo;
  jj: ToolInfo;
}

export async function discoverTools(): Promise<ToolDiscovery> {
  return invoke<ToolDiscovery>("discover_tools");
}
