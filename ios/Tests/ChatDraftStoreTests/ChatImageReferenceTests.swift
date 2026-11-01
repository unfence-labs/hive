import Foundation
import Testing
@testable import HiveMobileStoresCore

@Suite("Chat image references")
struct ChatImageReferenceTests {
    private func source(_ value: String, workspaceId: String? = "ws-1") -> String? {
        guard let url = URL(string: value) else { return nil }
        return ChatImageReference.source(for: url, workspaceId: workspaceId)
    }

    @Test("Absolute server paths use the current workspace raw file endpoint")
    func absolutePath() throws {
        let value = try #require(source("/home/hive/project/workspaces/main/artifacts/teaser.png"))
        let components = try #require(URLComponents(string: value))
        #expect(components.path == "/api/workspaces/ws-1/file/raw")
        #expect(components.queryItems == [URLQueryItem(name: "path", value: "/home/hive/project/workspaces/main/artifacts/teaser.png")])
        #expect(components.host == nil)
        #expect(components.scheme == nil)
    }

    @Test("Relative paths, uppercase extensions and Brain images are supported")
    func relativeAndBrainPaths() throws {
        let relative = try #require(source("./artifacts/preview.JPG"))
        #expect(URLComponents(string: relative)?.queryItems?.first?.value == "./artifacts/preview.JPG")
        let brain = try #require(source("images/preview.png", workspaceId: "brain"))
        #expect(URLComponents(string: brain)?.path == "/api/brain/file/raw")
    }

    @Test("Reserved filename characters are encoded once and remain query data")
    func filenameEncoding() throws {
        let path = "/repo/mockups/été + 80% #1 & next?.png"
        var reference = URLComponents()
        reference.path = path
        let url = try #require(reference.url)
        let result = try #require(ChatImageReference.source(for: url, workspaceId: "ws-1"))
        let components = try #require(URLComponents(string: result))
        #expect(components.queryItems == [URLQueryItem(name: "path", value: path)])
        #expect(components.fragment == nil)
        #expect(result.contains("%2B"))
        #expect(!result.contains("+"))
    }

    @Test("Workspace identifiers cannot inject a path or query")
    func workspaceEncoding() throws {
        let result = try #require(source("teaser.png", workspaceId: "ws/other?token=bad"))
        #expect(result.hasPrefix("/api/workspaces/ws%2Fother%3Ftoken%3Dbad/file/raw?"))
        #expect(URLComponents(string: result)?.queryItems?.count == 1)
    }

    @Test("Only image links are handled and workspace context is required for files")
    func nonImagesAndMissingWorkspace() {
        for value in ["README.md", "/repo/report.pdf", "/repo/image.png.md", "#image.png", "", "/api/status.png"] {
            #expect(source(value) == nil)
        }
        #expect(source("image.png", workspaceId: nil) == nil)
        #expect(source("image.png", workspaceId: "") == nil)
    }

    @Test("External origins and protocols never become authenticated API requests")
    func externalURLs() {
        for value in [
            "https://example.com/image.png",
            "http://example.com/api/workspaces/ws-1/file/raw?path=image.png",
            "//example.com/image.png",
            "//example.com/api/workspaces/ws-1/file/raw?path=image.png",
            "file://example.com/image.png",
            "ftp://example.com/image.png",
            "javascript:alert.png",
            "data:image/png;base64,AAAA",
        ] {
            #expect(source(value) == nil)
        }
    }

    @Test("A relative URL with a remote base retains its external origin")
    func remoteBase() throws {
        let base = try #require(URL(string: "https://example.com"))
        let reference = try #require(URL(string: "image.png", relativeTo: base))
        #expect(ChatImageReference.source(for: reference, workspaceId: "ws-1") == nil)
    }

    @Test("Local file URLs map to the server rather than the device filesystem")
    func fileURL() throws {
        let value = try #require(source("file:///repo/My%20Image.png"))
        #expect(URLComponents(string: value)?.queryItems?.first?.value == "/repo/My Image.png")
        #expect(source("file://localhost/repo/image.png") != nil)
    }

    @Test("Existing image API routes are recognized without workspace context")
    func apiRoutes() {
        for value in [
            "/api/workspaces/ws-1/file/raw?path=images%2Fteaser.png",
            "/api/brain/file/raw?path=teaser.png",
            "/api/workspaces/ws-1/sessions/session-1/attachments/teaser.png",
        ] {
            #expect(source(value, workspaceId: nil) != nil)
        }
        for value in [
            "/api/workspaces/ws-1/file/raw",
            "/api/workspaces/ws-1/file/raw?path=notes.md",
            "/api/workspaces/ws-1/file/raw?path=image.png&path=secret.txt",
            "/api/workspaces/ws-1/file?path=image.png",
            "/api/workspaces/ws-1/sessions/session-1/attachments/readme.md",
            "/api/workspaces/ws-1/delete?path=image.png",
        ] {
            #expect(source(value) == nil)
        }
    }

    @Test("API links remove old credentials and fragments without corrupting a plus sign")
    func apiCredentialsAndEncoding() throws {
        let value = try #require(source("/api/workspaces/ws-1/file/raw?path=a%2Bb.png&token=old&w=512#preview"))
        let components = try #require(URLComponents(string: value))
        #expect(components.queryItems?.contains(URLQueryItem(name: "path", value: "a+b.png")) == true)
        #expect(components.queryItems?.contains(URLQueryItem(name: "w", value: "512")) == true)
        #expect(components.queryItems?.contains(where: { $0.name == "token" }) == false)
        #expect(components.fragment == nil)
        #expect(value.contains("%2B"))
    }

    @Test("Control characters and backslashes are rejected")
    func invalidPaths() {
        #expect(source("/repo/%00image.png") == nil)
        #expect(source("/repo/%0Aimage.png") == nil)
        #expect(source("/repo/%5Cimage.png") == nil)
    }
}
