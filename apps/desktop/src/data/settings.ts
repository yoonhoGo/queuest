import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  autoUpdate: boolean;
  launchAtLogin: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoUpdate: true,
  launchAtLogin: true,
};

export async function loadAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("save_app_settings", { settings });
}
