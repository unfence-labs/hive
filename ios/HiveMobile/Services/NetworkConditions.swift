import Foundation
import Network

@MainActor
final class NetworkConditions {
    static let shared = NetworkConditions()

    private(set) var isConstrained = false
    private(set) var isExpensive = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.hive.networkpath")

    var isLowPowerMode: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }
    var shouldConserve: Bool { isConstrained || isExpensive || isLowPowerMode }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let constrained = path.isConstrained
            let expensive = path.isExpensive
            Task { @MainActor in
                self?.isConstrained = constrained
                self?.isExpensive = expensive
            }
        }
        monitor.start(queue: queue)
    }
}

enum HiveHTTP {
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 256 * 1024 * 1024
        )
        config.requestCachePolicy = .useProtocolCachePolicy
        config.httpMaximumConnectionsPerHost = 6
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    static func clearCache() {
        session.configuration.urlCache?.removeAllCachedResponses()
    }
}
