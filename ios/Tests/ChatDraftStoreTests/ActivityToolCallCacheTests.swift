import Testing
@testable import HiveMobileStoresCore

struct ActivityToolCallCacheTests {
    @Test
    func repeatedAccessesReturnStableToolCalls() {
        let activity = AgentActivity.fileChange(.init(
            id: "file-stability-1",
            status: "completed",
            files: [.init(path: "a.swift", diff: "+new", kind: "update", status: nil)]
        ))

        let first = activity.toolCalls
        let second = activity.toolCalls

        #expect(first == second)
        #expect(first.count == 1)
        #expect(first.first?.id == "file-stability-1:0:a.swift")
    }

    @Test
    func sameIdActivityWithChangedDiffInvalidatesCache() throws {
        let initial = AgentActivity.fileChange(.init(
            id: "file-invalidation-1",
            status: "inProgress",
            files: [.init(path: "a.swift", diff: "+one", kind: "update", status: nil)]
        ))
        #expect(initial.toolCalls.first?.output == "+one")

        let updated = AgentActivity.fileChange(.init(
            id: "file-invalidation-1",
            status: "completed",
            files: [.init(path: "a.swift", diff: "+one\n+two", kind: "update", status: nil)]
        ))
        let tool = try #require(updated.toolCalls.first)
        let input = try #require(parsedToolInputObject(tool.input))

        #expect(input["diff"] as? String == "+one\n+two")
        #expect(tool.output == "+one\n+two")
    }

    @Test
    func kindsWithoutToolCallsReturnEmpty() {
        let plan = AgentActivity.planUpdate(.init(
            id: "plan-1",
            steps: [.init(text: "Inspect", status: "completed")]
        ))
        #expect(plan.toolCalls.isEmpty)
    }
}
