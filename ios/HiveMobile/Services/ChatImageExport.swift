import Foundation

/// A local copy of the original image bytes, retained while the share sheet uses it.
/// Neither the server URL nor its authentication query is exposed to other apps.
final class ChatImageExport: Identifiable, Sendable {
    enum ExportError: Error {
        case invalidImage
    }

    let id = UUID()
    let url: URL
    private let directory: URL

    init(
        data: Data,
        fileExtension: String,
        temporaryRoot: URL = FileManager.default.temporaryDirectory
    ) throws {
        guard !data.isEmpty, !fileExtension.isEmpty, fileExtension.count <= 10,
              fileExtension.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) }) else {
            throw ExportError.invalidImage
        }

        directory = temporaryRoot.appendingPathComponent("hive-image-\(id.uuidString)", isDirectory: true)
        url = directory.appendingPathComponent("image.\(fileExtension.lowercased())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    deinit {
        try? FileManager.default.removeItem(at: directory)
    }
}
