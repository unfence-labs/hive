import Foundation
import Observation

struct ModelProviderGroup: Identifiable {
    let provider: String
    let providerLabel: String
    var models: [ModelCatalogEntry]

    var id: String { provider }
}

@MainActor
@Observable
final class ModelCatalog {
    private(set) var models: [ModelCatalogEntry] = []
    private(set) var defaultModelId: String = ""
    private(set) var isLoaded = false

    private let api = APIClient()

    func loadIfNeeded() async {
        guard !isLoaded else { return }
        await load()
    }

    func load() async {
        do {
            let response = try await api.fetchModels()
            models = response.models
            defaultModelId = response.defaultModelId
            isLoaded = true
        } catch is CancellationError {
            // View disappeared
        } catch {
            // Non-fatal: picker will be empty until catalog arrives
        }
    }

    func model(for id: String) -> ModelCatalogEntry? {
        models.first { $0.id == id }
    }

    var groupedByProvider: [ModelProviderGroup] {
        var seen: [String: Int] = [:]
        var groups: [ModelProviderGroup] = []
        for model in models {
            if let idx = seen[model.provider] {
                groups[idx].models.append(model)
            } else {
                seen[model.provider] = groups.count
                groups.append(ModelProviderGroup(provider: model.provider, providerLabel: model.providerLabel, models: [model]))
            }
        }
        return groups
    }
}
