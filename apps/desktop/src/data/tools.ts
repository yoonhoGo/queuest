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

export interface InstalledApp {
  name: string;
  /** Absolute path to the `.app` bundle. */
  path: string;
}

export interface ToolInventory {
  tools: ToolDiscovery;
  /** Sorted by name; empty on non-macOS. */
  apps: InstalledApp[];
}

export async function discoverTools(): Promise<ToolDiscovery> {
  return invoke<ToolDiscovery>("discover_tools");
}

export async function discoverInventory(): Promise<ToolInventory> {
  return invoke<ToolInventory>("discover_inventory");
}

export async function loadAppIcon(path: string): Promise<string | null> {
  return invoke<string | null>("app_icon", { path });
}
