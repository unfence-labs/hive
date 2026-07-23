import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ModelCatalogDecodingTests {
    @Test
    func decodesKimiLabelsAndModelSpecificThinkingLevels() throws {
        let data = Data(
            """
            {
              "models": [
                {
                  "id": "kimi:k3",
                  "label": "K3",
                  "provider": "kimi",
                  "providerLabel": "Kimi",
                  "capabilities": {
                    "thinkingLevels": ["low", "high", "max"],
                    "planMode": true,
                    "blockingTools": true,
                    "completions": true,
                    "goals": false
                  },
                  "contextWindow": 262144
                },
                {
                  "id": "kimi:k3-1m",
                  "label": "K3 1M",
                  "provider": "kimi",
                  "providerLabel": "Kimi",
                  "capabilities": {
                    "thinkingLevels": ["low", "high", "max"],
                    "planMode": true,
                    "blockingTools": true,
                    "completions": true,
                    "goals": false
                  },
                  "contextWindow": 1048576
                },
                {
                  "id": "kimi:kimi-for-coding",
                  "label": "K2.7 Coding",
                  "provider": "kimi",
                  "providerLabel": "Kimi",
                  "capabilities": {
                    "thinkingLevels": [],
                    "planMode": true,
                    "blockingTools": true,
                    "completions": true,
                    "goals": false
                  },
                  "contextWindow": 262144
                },
                {
                  "id": "kimi:kimi-for-coding-highspeed",
                  "label": "K2.7 Coding Highspeed",
                  "provider": "kimi",
                  "providerLabel": "Kimi",
                  "capabilities": {
                    "thinkingLevels": [],
                    "planMode": true,
                    "blockingTools": true,
                    "completions": true,
                    "goals": false
                  },
                  "contextWindow": 262144
                }
              ],
              "defaultModelId": "claude:opus-4-8"
            }
            """.utf8
        )

        let catalog = try JSONDecoder().decode(ModelCatalogResponse.self, from: data)

        #expect(catalog.models.map(\.label) == [
            "K3",
            "K3 1M",
            "K2.7 Coding",
            "K2.7 Coding Highspeed"
        ])
        #expect(catalog.models[0].capabilities.thinkingLevels == [.low, .high, .max])
        #expect(catalog.models[1].capabilities.thinkingLevels == [.low, .high, .max])
        #expect(catalog.models[2].capabilities.thinkingLevels.isEmpty)
        #expect(catalog.models[3].capabilities.thinkingLevels.isEmpty)
    }
}
