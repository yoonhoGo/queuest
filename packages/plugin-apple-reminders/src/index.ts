import type {
  ExternalWorkItem,
  Page,
  PluginPermissions,
  WorkItemQuery,
} from "@queuest/plugin-contracts";
import {
  APPLE_REMINDERS_PLATFORM_PERMISSION as EVENTKIT_PLATFORM_PERMISSION,
  createEventKitPluginHandlers,
  EVENTKIT_ERROR_CODES,
  EventKitNativeClient,
  EventKitPluginError,
  parseWorkItemQuery as parseSharedWorkItemQuery,
  type EventKitNativeClientLike,
  type EventKitNativeClientOptions,
  type EventKitPluginHandlersOptions,
} from "@queuest/plugin-eventkit";
import type { PluginHandlers } from "@queuest/plugin-sdk";

export const APPLE_REMINDERS_PLUGIN_ID = "com.queuest.apple-reminders" as const;
export const APPLE_REMINDERS_PROVIDER_ID = "apple-reminders" as const;
export const APPLE_REMINDERS_PLATFORM_PERMISSION = EVENTKIT_PLATFORM_PERMISSION;
export const APPLE_REMINDERS_CAPABILITY = "source.work-items" as const;
export const APPLE_REMINDERS_ERROR_CODES = EVENTKIT_ERROR_CODES;

export const REMINDERS_PLUGIN_ID = APPLE_REMINDERS_PLUGIN_ID;
export const REMINDERS_PROVIDER_ID = APPLE_REMINDERS_PROVIDER_ID;
export const REMINDERS_PLATFORM_PERMISSION = APPLE_REMINDERS_PLATFORM_PERMISSION;
export const REMINDERS_ERROR_CODES = APPLE_REMINDERS_ERROR_CODES;
export const APPLE_EVENTKIT_REMINDERS_PERMISSION = APPLE_REMINDERS_PLATFORM_PERMISSION;

export type AppleRemindersPluginErrorCode = (typeof EVENTKIT_ERROR_CODES)[keyof typeof EVENTKIT_ERROR_CODES] | string;
export type AppleRemindersWorkItemQuery = WorkItemQuery;
export type AppleRemindersPluginHandlersOptions = Omit<EventKitPluginHandlersOptions, "resource">;
export type AppleRemindersPage = Page<ExternalWorkItem>;
export type AppleRemindersPermissions = PluginPermissions;
export type AppleRemindersNativeClient = EventKitNativeClientLike;

export { EventKitPluginError as AppleRemindersPluginError };

export class AppleRemindersEventKitClient extends EventKitNativeClient {
  public constructor(options: Omit<EventKitNativeClientOptions, "resource"> = {}) {
    super({ resource: "reminders", ...options });
  }
}

export const AppleRemindersClient = AppleRemindersEventKitClient;
export const RemindersEventKitClient = AppleRemindersEventKitClient;

export function createAppleRemindersPluginHandlers(
  options: AppleRemindersPluginHandlersOptions = {},
): PluginHandlers {
  return createEventKitPluginHandlers({
    resource: "reminders",
    requiredPlatformPermission: APPLE_REMINDERS_PLATFORM_PERMISSION,
    ...options,
  });
}

export const createRemindersPluginHandlers = createAppleRemindersPluginHandlers;
export const createAppleRemindersHandlers = createAppleRemindersPluginHandlers;
export const createHandlers = createAppleRemindersPluginHandlers;
export const parseWorkItemQuery = parseSharedWorkItemQuery;
export const parseReminderQuery = parseSharedWorkItemQuery;
export const parseRemindersQuery = parseSharedWorkItemQuery;
export const parseAppleRemindersQuery = parseSharedWorkItemQuery;
export const AppleRemindersApiError = EventKitPluginError;
