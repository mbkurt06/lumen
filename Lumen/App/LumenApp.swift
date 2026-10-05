import SwiftUI
import SwiftData

@main
struct LumenApp: App {
    private let modelContainer: ModelContainer

    init() {
        modelContainer = PersistenceController.makeContainer()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(modelContainer)
    }
}
