import SwiftUI
import SwiftData

struct RootView: View {
    @Query(sort: \LibraryItem.order) private var items: [LibraryItem]
    @Environment(\.modelContext) private var modelContext
    @State private var selectedItemID: UUID?

    private var rootItems: [LibraryItem] {
        items
            .filter { $0.parentID == nil }
            .sorted {
                if $0.order == $1.order {
                    return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                }
                return $0.order < $1.order
            }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedItemID) {
                ForEach(rootItems) { item in
                    Label(item.title, systemImage: item.kind.systemImage)
                        .tag(item.id)
                }
            }
            .navigationTitle("Lumen")
            .overlay {
                if rootItems.isEmpty {
                    ContentUnavailableView(
                        "Kütüphane boş",
                        systemImage: "books.vertical",
                        description: Text("İlk koleksiyonunu veya eserini ekleyebilirsin.")
                    )
                }
            }
            .toolbar {
                ToolbarItem {
                    Menu {
                        Button("Yeni koleksiyon", systemImage: "rectangle.stack.badge.plus") {
                            createItem(kind: .collection)
                        }
                        Button("Yeni eser", systemImage: "doc.badge.plus") {
                            createItem(kind: .document)
                        }
                    } label: {
                        Label("Ekle", systemImage: "plus")
                    }
                }
            }
        } detail: {
            if let selectedItem {
                ItemDetailView(item: selectedItem)
            } else {
                ContentUnavailableView("Bir öğe seç", systemImage: "sidebar.left")
            }
        }
    }

    private var selectedItem: LibraryItem? {
        guard let selectedItemID else { return nil }
        return items.first { $0.id == selectedItemID }
    }

    private func createItem(kind: LibraryItemKind) {
        let item = LibraryItem(
            title: kind == .collection ? "Yeni Koleksiyon" : "Yeni Eser",
            kind: kind,
            order: rootItems.count
        )
        modelContext.insert(item)
        selectedItemID = item.id
    }
}
