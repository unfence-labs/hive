// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "HiveMobileStores",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "HiveMobileStoresCore", targets: ["HiveMobileStoresCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-testing.git", from: "0.7.0")
    ],
    targets: [
        .target(
            name: "HiveMobileStoresCore",
            path: "HiveMobile/Stores",
            exclude: [
                "ConversationStore.swift",
                "HubStatusMonitor.swift",
                "ProjectStore.swift"
            ],
            sources: ["ChatDraftStore.swift"]
        ),
        .testTarget(
            name: "HiveMobileStoresCoreTests",
            dependencies: [
                "HiveMobileStoresCore",
                .product(name: "Testing", package: "swift-testing")
            ],
            path: "Tests/ChatDraftStoreTests"
        )
    ]
)
