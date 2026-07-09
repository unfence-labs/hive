import XCTest
@testable import HiveMobileStoresCore

final class AutomationFormattingTests: XCTestCase {

    func testEveryNMinutes() {
        XCTAssertEqual(AutomationFormatting.scheduleSummary("*/5 * * * *"), "Every 5 minutes")
        XCTAssertEqual(AutomationFormatting.scheduleSummary("*/1 * * * *"), "Every minute")
        XCTAssertEqual(AutomationFormatting.scheduleSummary("* * * * *"), "Every minute")
    }

    func testHourly() {
        XCTAssertEqual(AutomationFormatting.scheduleSummary("0 * * * *"), "Every hour")
        XCTAssertEqual(AutomationFormatting.scheduleSummary("30 * * * *"), "Hourly at :30")
    }

    func testEveryNHours() {
        XCTAssertEqual(AutomationFormatting.scheduleSummary("0 */2 * * *"), "Every 2 hours")
        XCTAssertEqual(AutomationFormatting.scheduleSummary("30 */1 * * *"), "Every hour")
    }

    func testDailyContainsTime() {
        let summary = AutomationFormatting.scheduleSummary("0 9 * * *")
        XCTAssertTrue(summary.hasPrefix("Daily at "), summary)
        XCTAssertTrue(summary.contains("9"), summary)
    }

    func testWeekdays() {
        XCTAssertTrue(AutomationFormatting.scheduleSummary("0 9 * * 1-5").hasPrefix("Weekdays at "))
        XCTAssertTrue(AutomationFormatting.scheduleSummary("0 8 * * 1").hasPrefix("Mon at "))
        XCTAssertTrue(AutomationFormatting.scheduleSummary("0 8 * * 1,3,5").hasPrefix("Mon, Wed, Fri at "))
    }

    func testIrregularExpressionsFallBackToRaw() {
        XCTAssertEqual(AutomationFormatting.scheduleSummary("0 9 1 * *"), "0 9 1 * *")
        XCTAssertEqual(AutomationFormatting.scheduleSummary("not a cron"), "not a cron")
        XCTAssertEqual(AutomationFormatting.scheduleSummary("0 9 * 2 *"), "0 9 * 2 *")
    }

    func testDurationFormatting() {
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 0), "0s")
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 500), "1s")
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 42_000), "42s")
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 60_000), "1m")
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 125_000), "2m 5s")
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 3_600_000), "1h")
        XCTAssertEqual(AutomationFormatting.duration(fromMs: 5_400_000), "1h 30m")
    }

    func testParseISOAcceptsBothPrecisions() {
        XCTAssertNotNil(AutomationFormatting.parseISO("2026-07-08T09:00:00.000Z"))
        XCTAssertNotNil(AutomationFormatting.parseISO("2026-07-08T09:00:00Z"))
        XCTAssertNil(AutomationFormatting.parseISO("yesterday"))
    }
}
