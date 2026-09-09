import { invoke } from "@tauri-apps/api/core";
import type { PluginConnection } from "@queuest/domain";
import { getRepository } from "./repository";

export async function loadPluginConnections(): Promise<PluginConnection[]> {
  return (await getRepository()).listPluginConnections();
}

export async function savePluginConnection(connection: PluginConnection): Promise<void> {
  await (await getRepository()).savePluginConnection(connection);
}

export async function deletePluginConnection(
  pluginId: string,
  connectionId: string,
): Promise<void> {
  await (await getRepository()).deletePluginConnection(pluginId, connectionId);
}

/** Store a provider credential through the native host Credential Store. */
export async function savePluginCredential(
  pluginId: string,
  connectionId: string,
  value: string,
): Promise<void> {
  await invoke("plugin_credential_set", { pluginId, connectionId, value });
}

/** Remove a provider credential without returning its value to the webview. */
export async function deletePluginCredential(
  pluginId: string,
  connectionId: string,
): Promise<void> {
  await invoke("plugin_credential_delete", { pluginId, connectionId });
}
