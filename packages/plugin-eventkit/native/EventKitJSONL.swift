import EventKit
import Foundation

// This executable is deliberately a small, synchronous JSONL boundary. The
// JavaScript packages own the Queuest protocol and validation; this process is
// the only layer that touches EventKit and the macOS TCC database.

private let protocolVersion = 1

private enum EventKitResource: String {
    case calendar
    case reminders

    var entityType: EKEntityType {
        switch self {
        case .calendar:
            return .event
        case .reminders:
            return .reminder
        }
    }

    var platformPermission: String {
        switch self {
        case .calendar:
            return "macos.eventkit.calendar"
        case .reminders:
            return "macos.eventkit.reminders"
        }
    }

    var displayName: String {
        switch self {
        case .calendar:
            return "Apple Calendar"
        case .reminders:
            return "Apple Reminders"
        }
    }
}

private struct ProtocolFailure: Error {
    let code: String
    let message: String
}

private struct ParsedRequest {
    let id: String
    let method: String
    let params: [String: Any]
}

private final class EventKitJSONLServer {
    private let resource: EventKitResource
    private let eventStore = EKEventStore()
    private var initialized = false

    init(resource: EventKitResource) {
        self.resource = resource
    }

    func run() {
        while let line = readLine() {
            handle(line)
        }
    }

    private func handle(_ line: String) {
        let id = requestID(from: line) ?? "unknown"
        do {
            let request = try parseRequest(line)
            let result = try dispatch(request)
            write(["protocolVersion": protocolVersion, "id": request.id, "result": result])
        } catch let failure as ProtocolFailure {
            write([
                "protocolVersion": protocolVersion,
                "id": id,
                "error": ["code": failure.code, "message": failure.message],
            ])
        } catch {
            // Do not forward Foundation/EventKit diagnostics. They can contain
            // account names, paths, or implementation details that are not
            // part of the stable plugin contract.
            write([
                "protocolVersion": protocolVersion,
                "id": id,
                "error": [
                    "code": "EVENTKIT_ERROR",
                    "message": "\(resource.displayName) 작업을 완료하지 못했습니다.",
                ],
            ])
        }
    }

    private func parseRequest(_ line: String) throws -> ParsedRequest {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            throw ProtocolFailure(code: "INVALID_JSON", message: "플러그인 요청이 유효한 JSON이 아닙니다.")
        }

        guard let version = dictionary["protocolVersion"] as? Int, version == protocolVersion else {
            throw ProtocolFailure(
                code: "INVALID_REQUEST",
                message: "지원하지 않는 plugin protocolVersion입니다.",
            )
        }
        guard let id = dictionary["id"] as? String, validText(id, maximum: 256) else {
            throw ProtocolFailure(code: "INVALID_REQUEST", message: "플러그인 요청 id가 유효하지 않습니다.")
        }
        guard let method = dictionary["method"] as? String, validText(method, maximum: 128) else {
            throw ProtocolFailure(code: "INVALID_REQUEST", message: "플러그인 요청 method가 유효하지 않습니다.")
        }
        guard let params = dictionary["params"] as? [String: Any] else {
            throw ProtocolFailure(code: "INVALID_REQUEST", message: "플러그인 요청 params가 유효하지 않습니다.")
        }
        return ParsedRequest(id: id, method: method, params: params)
    }

    private func dispatch(_ request: ParsedRequest) throws -> Any {
        switch request.method {
        case "initialize":
            return try initialize(request.params)
        case "health.check":
            return healthStatus()
        case "connection.status":
            guard initialized else { throw notInitialized() }
            _ = try connectionID(request.params)
            return healthStatus()
        case "tcc.status":
            guard initialized else { throw notInitialized() }
            return tccStatus()
        case "tcc.request-access":
            guard initialized else { throw notInitialized() }
            return try requestAccess()
        case "source.calendar-events.list":
            guard resource == .calendar else {
                throw ProtocolFailure(code: "CAPABILITY_UNSUPPORTED", message: "Apple Reminders 플러그인은 일정 capability를 구현하지 않습니다.")
            }
            return try listCalendarEvents(request.params)
        case "source.work-items.list":
            guard resource == .reminders else {
                throw ProtocolFailure(code: "CAPABILITY_UNSUPPORTED", message: "Apple Calendar 플러그인은 작업 항목 capability를 구현하지 않습니다.")
            }
            return try listReminders(request.params)
        case "shutdown":
            initialized = false
            return ["shutdown": true]
        default:
            throw ProtocolFailure(code: "INVALID_REQUEST", message: "지원하지 않는 plugin method입니다.")
        }
    }

    private func initialize(_ params: [String: Any]) throws -> Any {
        guard let permissions = params["grantedPermissions"] as? [String: Any],
              let platform = permissions["platform"] as? [Any],
              platform.compactMap({ $0 as? String }).contains(where: hasRequiredPlatformPermission) else {
            throw ProtocolFailure(
                code: "PERMISSION_DENIED",
                message: "\(resource.displayName) 플러그인의 macOS 권한 승인이 필요합니다.",
            )
        }
        initialized = true
        return ["initialized": true]
    }

    private func healthStatus() -> [String: Any] {
        guard initialized else {
            return [
                "state": "error",
                "message": "\(resource.displayName) 플러그인이 초기화되지 않았습니다.",
            ]
        }

        switch EKEventStore.authorizationStatus(for: resource.entityType) {
        case .fullAccess:
            return ["state": "connected"]
        case .notDetermined:
            return [
                "state": "needs-auth",
                "message": "\(resource.displayName) 접근 권한을 허용해 주세요.",
            ]
        case .denied:
            return [
                "state": "needs-auth",
                "message": "\(resource.displayName) 접근 권한이 거부되었습니다.",
            ]
        case .restricted:
            return [
                "state": "error",
                "message": "\(resource.displayName) 접근이 시스템 정책으로 제한되었습니다.",
            ]
        case .writeOnly:
            return [
                "state": "error",
                "message": "\(resource.displayName) 읽기 권한이 필요합니다.",
            ]
        @unknown default:
            return [
                "state": "error",
                "message": "\(resource.displayName) 접근 상태를 확인하지 못했습니다.",
            ]
        }
    }

    private func tccStatus() -> [String: Any] {
        let status = EKEventStore.authorizationStatus(for: resource.entityType)
        let name: String
        switch status {
        case .notDetermined:
            name = "notDetermined"
        case .restricted:
            name = "restricted"
        case .denied:
            name = "denied"
        case .fullAccess:
            name = "fullAccess"
        case .writeOnly:
            name = "writeOnly"
        @unknown default:
            name = "unknown"
        }
        return [
            "resource": resource.rawValue,
            "authorizationStatus": name,
            "readAccess": status == .fullAccess,
        ]
    }

    private func requestAccess() throws -> Any {
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        var completed = false

        if #available(macOS 14.0, *) {
            if resource == .calendar {
                eventStore.requestFullAccessToEvents { value, _ in
                    granted = value
                    completed = true
                    semaphore.signal()
                }
            } else {
                eventStore.requestFullAccessToReminders { value, _ in
                    granted = value
                    completed = true
                    semaphore.signal()
                }
            }
        } else {
            eventStore.requestAccess(to: resource.entityType) { value, _ in
                granted = value
                completed = true
                semaphore.signal()
            }
        }

        if semaphore.wait(timeout: .now() + 30) == .timedOut || !completed {
            throw ProtocolFailure(code: "TCC_REQUEST_FAILED", message: "\(resource.displayName) 접근 권한 요청이 시간 초과되었습니다.")
        }
        if !granted {
            throw tccFailure()
        }
        return tccStatus()
    }

    private func listCalendarEvents(_ params: [String: Any]) throws -> Any {
        try requireReadAccess()
        let connection = try connectionID(params)
        let calendarIDs = try stringArray(params["calendarIds"], field: "calendarIds", maximum: 100)
        let startsAt = try requiredText(params["startsAt"], field: "startsAt", maximum: 128)
        let endsAt = try requiredText(params["endsAt"], field: "endsAt", maximum: 128)
        guard let start = parseDate(startsAt), let end = parseDate(endsAt), start <= end else {
            throw ProtocolFailure(code: "INVALID_INPUT", message: "Apple Calendar 시간 범위가 유효하지 않습니다.")
        }
        let offset = try cursorOffset(params["cursor"])
        let calendars = selectedCalendars(calendarIDs, entityType: .event)
        let events = eventStore.events(matching: eventStore.predicateForEvents(withStart: start, end: end, calendars: calendars))
            .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
        let page = Array(events.dropFirst(offset).prefix(250))
        var items: [[String: Any]] = []
        for event in page {
            guard let eventStart = event.startDate, let eventEnd = event.endDate else {
                continue
            }
            let identifier = event.eventIdentifier ?? event.calendarItemIdentifier
            guard validText(identifier, maximum: 1024) else { continue }
            let allDay = event.isAllDay
            let starts = allDay ? dateOnly(eventStart) : iso8601(eventStart)
            let ends = allDay ? dateOnly(eventEnd) : iso8601(eventEnd)
            var item: [String: Any] = [
                "providerId": "apple-calendar",
                "connectionId": connection,
                "externalId": identifier,
                "calendarId": event.calendar.calendarIdentifier,
                "title": bounded(event.title ?? "", maximum: 8192),
                "startsAt": starts,
                "endsAt": ends,
                "allDay": allDay,
                "status": eventStatus(event.status),
            ]
            if let url = event.url?.absoluteString, validText(url, maximum: 8192) {
                item["sourceUrl"] = url
            }
            if let modified = event.lastModifiedDate {
                item["updatedAt"] = iso8601(modified)
            }
            items.append(item)
        }
        return pageResult(items: items, offset: offset, total: events.count)
    }

    private func listReminders(_ params: [String: Any]) throws -> Any {
        try requireReadAccess()
        let connection = try connectionID(params)
        let repository = try optionalText(params["repository"], field: "repository", maximum: 512)
            ?? optionalText(params["listId"], field: "listId", maximum: 512)
        let offset = try cursorOffset(params["cursor"])
        let calendars = selectedCalendars(repository.map { [$0] } ?? ["*"], entityType: .reminder)
        let predicate = eventStore.predicateForReminders(in: calendars)
        let semaphore = DispatchSemaphore(value: 0)
        var reminders: [EKReminder] = []
        var fetchFailed = false
        eventStore.fetchReminders(matching: predicate) { values in
            reminders = values ?? []
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + 30) == .timedOut {
            fetchFailed = true
        }
        if fetchFailed {
            throw ProtocolFailure(code: "EVENTKIT_READ_FAILED", message: "Apple Reminders 항목을 읽지 못했습니다.")
        }

        reminders.sort {
            let left = $0.lastModifiedDate ?? $0.dueDateComponents?.date ?? .distantPast
            let right = $1.lastModifiedDate ?? $1.dueDateComponents?.date ?? .distantPast
            return left < right
        }
        let page = Array(reminders.dropFirst(offset).prefix(250))
        var items: [[String: Any]] = []
        for reminder in page {
            let identifier = reminder.calendarItemIdentifier
            guard validText(identifier, maximum: 1024) else { continue }
            let sourceURL = reminder.url?.absoluteString ?? "x-apple-reminders://reminder/\(percentEncode(identifier))"
            var item: [String: Any] = [
                "providerId": "apple-reminders",
                "connectionId": connection,
                "externalId": identifier,
                "externalRef": "apple-reminders:\(identifier)",
                "sourceUrl": bounded(sourceURL, maximum: 8192),
                "title": bounded(reminder.title ?? "", maximum: 8192),
                "body": bounded(reminder.notes ?? "", maximum: 16384),
                "status": reminder.isCompleted ? "closed" : "open",
                "labels": [bounded(reminder.calendar.title, maximum: 512)],
            ]
            if let modified = reminder.lastModifiedDate {
                item["updatedAt"] = iso8601(modified)
            }
            items.append(item)
        }
        return pageResult(items: items, offset: offset, total: reminders.count)
    }

    private func pageResult(items: [[String: Any]], offset: Int, total: Int) -> [String: Any] {
        var result: [String: Any] = ["items": items]
        let next = offset + items.count
        if next < total {
            result["nextCursor"] = String(next)
        }
        return result
    }

    private func requireReadAccess() throws {
        guard initialized else { throw notInitialized() }
        let status = EKEventStore.authorizationStatus(for: resource.entityType)
        guard status == .fullAccess else {
            throw tccFailure()
        }
    }

    private func tccFailure() -> ProtocolFailure {
        let status = EKEventStore.authorizationStatus(for: resource.entityType)
        switch status {
        case .notDetermined:
            return ProtocolFailure(code: "TCC_NOT_DETERMINED", message: "\(resource.displayName) 접근 권한 요청이 필요합니다.")
        case .denied:
            return ProtocolFailure(code: "TCC_DENIED", message: "\(resource.displayName) 접근 권한이 거부되었습니다.")
        case .restricted:
            return ProtocolFailure(code: "TCC_RESTRICTED", message: "\(resource.displayName) 접근이 시스템 정책으로 제한되었습니다.")
        case .writeOnly:
            return ProtocolFailure(code: "TCC_READ_ACCESS_REQUIRED", message: "\(resource.displayName) 읽기 권한이 필요합니다.")
        case .fullAccess:
            return ProtocolFailure(code: "TCC_ERROR", message: "\(resource.displayName) 접근 상태를 확인하지 못했습니다.")
        @unknown default:
            return ProtocolFailure(code: "TCC_ERROR", message: "\(resource.displayName) 접근 상태를 확인하지 못했습니다.")
        }
    }

    private func selectedCalendars(_ identifiers: [String], entityType: EKEntityType) -> [EKCalendar] {
        let available = eventStore.calendars(for: entityType)
        if identifiers.contains("*") {
            return available
        }
        let wanted = Set(identifiers)
        return available.filter { wanted.contains($0.calendarIdentifier) }
    }

    private func eventStatus(_ status: EKEventStatus) -> String {
        switch status {
        case .confirmed:
            return "confirmed"
        case .tentative:
            return "tentative"
        case .canceled:
            return "cancelled"
        case .none:
            return "confirmed"
        @unknown default:
            return "confirmed"
        }
    }

    private func connectionID(_ params: [String: Any]) throws -> String {
        try requiredText(params["connectionId"], field: "connectionId", maximum: 256)
    }

    private func requiredText(_ value: Any?, field: String, maximum: Int) throws -> String {
        guard let text = value as? String, validText(text, maximum: maximum) else {
            throw ProtocolFailure(code: "INVALID_INPUT", message: "Apple EventKit \(field)가 유효하지 않습니다.")
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func optionalText(_ value: Any?, field: String, maximum: Int) throws -> String? {
        if value == nil || value is NSNull { return nil }
        return try requiredText(value, field: field, maximum: maximum)
    }

    private func stringArray(_ value: Any?, field: String, maximum: Int) throws -> [String] {
        guard let values = value as? [Any], !values.isEmpty, values.count <= maximum else {
            throw ProtocolFailure(code: "INVALID_INPUT", message: "Apple EventKit \(field)가 유효하지 않습니다.")
        }
        var strings: [String] = []
        for value in values {
            strings.append(try requiredText(value, field: field, maximum: 512))
        }
        guard Set(strings).count == strings.count else {
            throw ProtocolFailure(code: "INVALID_INPUT", message: "Apple EventKit \(field)에 중복 항목이 있습니다.")
        }
        return strings
    }

    private func cursorOffset(_ value: Any?) throws -> Int {
        if value == nil || value is NSNull { return 0 }
        guard let text = value as? String, text.count <= 12, text.allSatisfy({ $0.isNumber }), let offset = Int(text) else {
            throw ProtocolFailure(code: "INVALID_INPUT", message: "Apple EventKit page cursor가 유효하지 않습니다.")
        }
        return offset
    }

    private func hasRequiredPlatformPermission(_ value: String) -> Bool {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch resource {
        case .calendar:
            return normalized == "macos.eventkit.calendar" || normalized == "eventkit.calendar" || normalized == "macos.calendar"
        case .reminders:
            return normalized == "macos.eventkit.reminders" || normalized == "eventkit.reminders" || normalized == "macos.reminders"
        }
    }

    private func notInitialized() -> ProtocolFailure {
        ProtocolFailure(code: "NOT_INITIALIZED", message: "\(resource.displayName) 플러그인이 초기화되지 않았습니다.")
    }

    private func write(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              var line = String(data: data, encoding: .utf8) else {
            return
        }
        line.append("\n")
        FileHandle.standardOutput.write(line.data(using: .utf8)!)
    }
}

private func requestID(from line: String) -> String? {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = object["id"] as? String,
          validText(id, maximum: 256) else {
        return nil
    }
    return id
}

private func validText(_ value: String, maximum: Int) -> Bool {
    !value.isEmpty && value.count <= maximum && !value.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f })
}

private func bounded(_ value: String, maximum: Int) -> String {
    String(value.prefix(maximum))
}

private let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private let plainIsoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}()

private let dateOnlyFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
}()

private func parseDate(_ value: String) -> Date? {
    isoFormatter.date(from: value) ?? plainIsoFormatter.date(from: value)
}

private func iso8601(_ value: Date) -> String {
    isoFormatter.string(from: value)
}

private func dateOnly(_ value: Date) -> String {
    dateOnlyFormatter.string(from: value)
}

private func percentEncode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "item"
}

let resourceArgument = CommandLine.arguments.dropFirst().first(where: { $0 == "calendar" || $0 == "reminders" }) ?? "calendar"
private let resource = EventKitResource(rawValue: resourceArgument) ?? .calendar
EventKitJSONLServer(resource: resource).run()
