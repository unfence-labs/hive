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
    targets: [
        .target(
            name: "HiveMobileStoresCore",
            path: "HiveMobile",
            exclude: [
                "Assets.xcassets",
                "HiveApp.swift",
                "HiveMobile.entitlements",
                "Services",
                "Stores/ConversationStoreCache.swift",
                "Stores/HubStatusMonitor.swift",
                "Stores/ModelCatalog.swift",
                "Stores/ProjectStore.swift",
                "Theme",
                "Views"
            ],
            sources: [
                "Models/AgentActivity.swift",
                "Models/BrainModels.swift",
                "Models/ConversationSurfaceModels.swift",
                "Models/Models.swift",
                "Models/WebSocketTypes.swift",
                "Stores/BackgroundAgentDerivation.swift",
                "Stores/ChatDraftStore.swift",
                "Stores/ConversationStore.swift",
                "Stores/GoalDerivation.swift",
                "Stores/GoalFormatting.swift",
                "Stores/HubOrganization.swift",
                "Stores/SubAgentStatus.swift",
                "Stores/TaskDerivation.swift",
                "Stores/TokenFormatting.swift"
            ]
        ),
        .testTarget(
            name: "HiveMobileStoresCoreTests",
            dependencies: [
                "HiveMobileStoresCore"
            ],
            path: "Tests/ChatDraftStoreTests"
        )
    ]
)
