import Foundation

/// Presentation helpers for the read-only Automations surface: humanized cron
/// schedules, run durations, and ISO timestamp parsing.
enum AutomationFormatting {

    /// Human summary for the common 5-field cron shapes; falls back to the raw
    /// expression for anything irregular.
    static func scheduleSummary(_ expression: String) -> String {
        let fields = expression.split(separator: " ").map(String.init)
        guard fields.count == 5 else { return expression }
        let (minute, hour, dayOfMonth, month, dayOfWeek) = (fields[0], fields[1], fields[2], fields[3], fields[4])
        guard dayOfMonth == "*", month == "*" else { return expression }

        if minute.hasPrefix("*/"), hour == "*", dayOfWeek == "*", let n = Int(minute.dropFirst(2)) {
            return n == 1 ? "Every minute" : "Every \(n) minutes"
        }
        if minute == "*", hour == "*", dayOfWeek == "*" {
            return "Every minute"
        }
        if hour.hasPrefix("*/"), dayOfWeek == "*", Int(minute) != nil, let n = Int(hour.dropFirst(2)) {
            return n == 1 ? "Every hour" : "Every \(n) hours"
        }
        if hour == "*", dayOfWeek == "*", let m = Int(minute) {
            return m == 0 ? "Every hour" : "Hourly at :\(String(format: "%02d", m))"
        }
        guard let m = Int(minute), let h = Int(hour) else { return expression }
        let time = clockTime(hour: h, minute: m)
        if dayOfWeek == "*" {
            return "Daily at \(time)"
        }
        if let days = weekdayList(dayOfWeek) {
            return "\(days) at \(time)"
        }
        return expression
    }

    static func duration(fromMs ms: Int) -> String {
        let totalSeconds = ms / 1000
        if totalSeconds < 60 { return "\(max(totalSeconds, ms > 0 ? 1 : 0))s" }
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        if minutes < 60 { return seconds == 0 ? "\(minutes)m" : "\(minutes)m \(seconds)s" }
        let hours = minutes / 60
        let remMinutes = minutes % 60
        return remMinutes == 0 ? "\(hours)h" : "\(hours)h \(remMinutes)m"
    }

    static func parseISO(_ value: String) -> Date? {
        isoWithFractional.date(from: value) ?? iso.date(from: value)
    }

    static func relative(_ value: String, to reference: Date = Date()) -> String? {
        guard let date = parseISO(value) else { return nil }
        return relativeFormatter.localizedString(for: date, relativeTo: reference)
    }

    static func absolute(_ value: String) -> String? {
        guard let date = parseISO(value) else { return nil }
        return absoluteFormatter.string(from: date)
    }

    // MARK: - Private

    private static func clockTime(hour: Int, minute: Int) -> String {
        var components = DateComponents()
        components.hour = hour
        components.minute = minute
        if let date = Calendar.current.date(from: components) {
            return timeFormatter.string(from: date)
        }
        return String(format: "%d:%02d", hour, minute)
    }

    private static func weekdayList(_ field: String) -> String? {
        let names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        if field == "1-5" { return "Weekdays" }
        if field == "0,6" || field == "6,0" { return "Weekends" }
        var result: [String] = []
        for part in field.split(separator: ",") {
            guard let day = Int(part), (0...7).contains(day) else { return nil }
            result.append(names[day % 7])
        }
        return result.isEmpty ? nil : result.joined(separator: ", ")
    }

    private static let isoWithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()

    private static let absoluteFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}
