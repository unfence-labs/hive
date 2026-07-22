import Foundation
import Testing
@testable import HiveMobileStoresCore

struct WorkspaceDecodingTests {
    @Test
    func decodesWorkspaceWithSourceAndDraftPrompt() throws {
        let data = """
        {
          "id": "workspace-1",
          "name": "fix-login-bug",
          "branch": "fix-login-bug",
          "status": "idle",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "activeSessionId": null,
          "projectName": "hive",
          "defaultBranch": "main",
          "source": {
            "kind": "issue",
            "number": 42,
            "title": "Login button unresponsive",
            "url": "https://github.com/example/hive/issues/42"
          },
          "draftPrompt": "Work on issue #42: Login button unresponsive"
        }
        """.data(using: .utf8)!

        let workspace = try JSONDecoder().decode(Workspace.self, from: data)

        #expect(workspace.id == "workspace-1")
        #expect(workspace.source?.kind == "issue")
        #expect(workspace.source?.branch == nil)
        #expect(workspace.source?.number == 42)
        #expect(workspace.source?.title == "Login button unresponsive")
        #expect(workspace.source?.url == "https://github.com/example/hive/issues/42")
        #expect(workspace.draftPrompt == "Work on issue #42: Login button unresponsive")
    }

    @Test
    func decodesWorkspaceWithoutSourceOrDraftPrompt() throws {
        let data = """
        {
          "id": "workspace-2",
          "name": "main",
          "branch": "main",
          "status": "busy",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "activeSessionId": "session-1",
          "projectName": "hive",
          "defaultBranch": "main"
        }
        """.data(using: .utf8)!

        let workspace = try JSONDecoder().decode(Workspace.self, from: data)

        #expect(workspace.id == "workspace-2")
        #expect(workspace.source == nil)
        #expect(workspace.draftPrompt == nil)
    }

    @Test
    func decodesWorkspaceSourceWithUnknownKind() throws {
        // A future backend "kind" value must not fail decoding — `kind` is a
        // plain String on purpose, not an enum.
        let data = """
        {
          "id": "workspace-3",
          "name": "main",
          "branch": "main",
          "status": "idle",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "activeSessionId": null,
          "projectName": "hive",
          "defaultBranch": "main",
          "source": {
            "kind": "some-future-kind"
          }
        }
        """.data(using: .utf8)!

        let workspace = try JSONDecoder().decode(Workspace.self, from: data)

        #expect(workspace.source?.kind == "some-future-kind")
        #expect(workspace.source?.branch == nil)
        #expect(workspace.source?.number == nil)
    }
}
