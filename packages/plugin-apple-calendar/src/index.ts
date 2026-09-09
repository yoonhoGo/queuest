import type {
  CalendarQuery,
  ExternalCalendarEvent,
  Page,
  PluginPermissions,
} from "@queuest/plugin-contracts";
import {
  APPLE_CALENDAR_PLATFORM_PERMISSION as EVENTKIT_PLATFORM_PERMISSION,
  createEventKitPluginHandlers,
  EVENTKIT_ERROR_CODES,
  EventKitNativeClient,
  EventKitPluginError,
  parseCalendarQuery as parseSharedCalendarQuery,
  type EventKitNativeClientLike,
  type EventKitNativeClientOptions,
  type EventKitPluginHandlersOptions,
} from "@queuest/plugin-eventkit";
import type { PluginHandlers } from "@queuest/plugin-sdk";

export const APPLE_CALENDAR_PLUGIN_ID = "com.queuest.apple-calendar" as const;
export const APPLE_CALENDAR_PROVIDER_ID = "apple-calendar" as const;
export const APPLE_CALENDAR_PLATFORM_PERMISSION = EVENTKIT_PLATFORM_PERMISSION;
export const APPLE_CALENDAR_CAPABILITY = "source.calendar-events" as const;
export const APPLE_CALENDAR_ERROR_CODES = EVENTKIT_ERROR_CODES;

// Short aliases make this package fit the existing Calendar connector API
// while preserving an unambiguous Apple identity for new callers.
export const CALENDAR_PLUGIN_ID = APPLE_CALENDAR_PLUGIN_ID;
export const CALENDAR_PROVIDER_ID = APPLE_CALENDAR_PROVIDER_ID;
export const CALENDAR_PLATFORM_PERMISSION = APPLE_CALENDAR_PLATFORM_PERMISSION;
export const CALENDAR_ERROR_CODES = APPLE_CALENDAR_ERROR_CODES;
export const APPLE_EVENTKIT_CALENDAR_PERMISSION = APPLE_CALENDAR_PLATFORM_PERMISSION;

export type AppleCalendarPluginErrorCode = (typeof EVENTKIT_ERROR_CODES)[keyof typeof EVENTKIT_ERROR_CODES] | string;
export type AppleCalendarEventQuery = CalendarQuery;
export type AppleCalendarPluginHandlersOptions = Omit<EventKitPluginHandlersOptions, "resource">;
export type AppleCalendarPage = Page<ExternalCalendarEvent>;
export type AppleCalendarPermissions = PluginPermissions;
export type AppleCalendarNativeClient = EventKitNativeClientLike;

export { EventKitPluginError as AppleCalendarPluginError };

export class AppleCalendarEventKitClient extends EventKitNativeClient {
  public constructor(options: Omit<EventKitNativeClientOptions, "resource"> = {}) {
    super({ resource: "calendar", ...options });
  }
}

export const AppleCalendarClient = AppleCalendarEventKitClient;
export const CalendarEventKitClient = AppleCalendarEventKitClient;

export function createAppleCalendarPluginHandlers(
  options: AppleCalendarPluginHandlersOptions = {},
): PluginHandlers {
  return createEventKitPluginHandlers({
    resource: "calendar",
    requiredPlatformPermission: APPLE_CALENDAR_PLATFORM_PERMISSION,
    ...options,
  });
}

export const createCalendarPluginHandlers = createAppleCalendarPluginHandlers;
export const createAppleCalendarHandlers = createAppleCalendarPluginHandlers;
export const createHandlers = createAppleCalendarPluginHandlers;
export const parseCalendarQuery = parseSharedCalendarQuery;
export const parseCalendarEventQuery = parseSharedCalendarQuery;
export const parseAppleCalendarQuery = parseSharedCalendarQuery;
export const AppleCalendarApiError = EventKitPluginError;
