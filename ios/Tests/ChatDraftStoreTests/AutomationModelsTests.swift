import XCTest
@testable import HiveMobileStoresCore

final class AutomationModelsTests: XCTestCase {

    func testDecodesAutomationList() throws {
        let json = """
        [{
            "id": "auto-abc12345",
            "name": "Nightly triage",
            "enabled": true,
            "projectId": "proj-1",
            "trigger": { "type": "cron", "expression": "0 9 * * *" },
            "action": { "type": "agent", "agentId": "agent-1", "userPromptInline": "Triage the backlog" },
            "notification": { "onComplete": true, "onFailure": true },
            "lastRunId": "run-1",
            "lastRunAt": "2026-07-08T09:00:00.000Z",
            "lastRunStatus": "failure",
            "createdAt": "2026-07-01T00:00:00.000Z",
            "updatedAt": "2026-07-08T09:00:00.000Z"
        }]
        """
        let automations = try JSONDecoder().decode([Automation].self, from: Data(json.utf8))
        XCTAssertEqual(automations.count, 1)
        let auto = try XCTUnwrap(automations.first)
        XCTAssertEqual(auto.name, "Nightly triage")
        XCTAssertEqual(auto.trigger.expression, "0 9 * * *")
        XCTAssertEqual(auto.lastRunStatus, .failure)
        XCTAssertEqual(auto.action.userPromptInline, "Triage the backlog")
        XCTAssertNil(auto.workspacePath)
    }

    func testDecodesAutomationWithoutOptionalFields() throws {
        let json = """
        {
            "id": "auto-min",
            "name": "Minimal",
            "enabled": false,
            "trigger": { "type": "cron", "expression": "*/5 * * * *" },
            "action": { "type": "agent", "agentId": "agent-1" },
            "notification": { "onComplete": false, "onFailure": true },
            "createdAt": "2026-07-01T00:00:00.000Z",
            "updatedAt": "2026-07-01T00:00:00.000Z"
        }
        """
        let auto = try JSONDecoder().decode(Automation.self, from: Data(json.utf8))
        XCTAssertFalse(auto.enabled)
        XCTAssertNil(auto.lastRunStatus)
        XCTAssertNil(auto.projectId)
    }

    func testDecodesRuns() throws {
        let json = """
        [{
            "id": "run-1",
            "automationId": "auto-abc12345",
            "status": "success",
            "sessionId": "sess-1",
            "startedAt": "2026-07-08T09:00:00.000Z",
            "completedAt": "2026-07-08T09:02:05.000Z",
            "durationMs": 125000,
            "summary": "Triaged 4 issues"
        },{
            "id": "run-2",
            "automationId": "auto-abc12345",
            "status": "running",
            "sessionId": "sess-2",
            "startedAt": "2026-07-09T09:00:00.000Z"
        }]
        """
        let runs = try JSONDecoder().decode([AutomationRun].self, from: Data(json.utf8))
        XCTAssertEqual(runs.map(\.status), [.success, .running])
        XCTAssertEqual(runs[0].durationMs, 125000)
        XCTAssertNil(runs[1].completedAt)
    }

    func testDecodesRunLogWithChatMessages() throws {
        let json = """
        {
            "messages": [
                { "id": "m-1", "sessionId": "sess-1", "role": "user",
                  "content": "Triage the backlog", "timestamp": "2026-07-08T09:00:00.000Z" },
                { "id": "m-2", "sessionId": "sess-1", "role": "assistant",
                  "content": "Done.", "timestamp": "2026-07-08T09:01:00.000Z",
                  "toolCalls": [{ "id": "t-1", "name": "Bash", "input": "ls" }] }
            ],
            "systemPrompt": "You are a triage agent."
        }
        """
        let log = try JSONDecoder().decode(AutomationRunLog.self, from: Data(json.utf8))
        XCTAssertEqual(log.messages.count, 2)
        XCTAssertEqual(log.messages[0].role, .user)
        XCTAssertEqual(log.messages[1].toolCalls?.first?.name, "Bash")
        XCTAssertEqual(log.systemPrompt, "You are a triage agent.")
    }

    func testDecodesRunLogWithoutSystemPrompt() throws {
        let log = try JSONDecoder().decode(AutomationRunLog.self, from: Data(#"{"messages": []}"#.utf8))
        XCTAssertTrue(log.messages.isEmpty)
        XCTAssertNil(log.systemPrompt)
    }
}
