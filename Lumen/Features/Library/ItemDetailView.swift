import SwiftUI
import SwiftData

struct ItemDetailView: View {
    let item: LibraryItem

    var body: some View {
        Group {
            switch item.kind {
            case .document:
                ReaderView(document: item)
            case .collection, .folder:
                CollectionView(container: item)
            }
        }
        .navigationTitle(item.title)
    }
}

private struct CollectionView: View {
    let container: LibraryItem

    @Query(sort: \LibraryItem.order) private var allItems: [LibraryItem]
    @Environment(\.modelContext) private var modelContext

    private var children: [LibraryItem] {
        allItems
            .filter { $0.parentID == container.id }
            .sorted {
                if $0.order == $1.order {
                    return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                }
                return $0.order < $1.order
            }
    }

    var body: some View {
        List {
            ForEach(children) { child in
                NavigationLink {
                    ItemDetailView(item: child)
                } label: {
                    Label(child.title, systemImage: child.kind.systemImage)
                }
            }
        }
        .overlay {
            if children.isEmpty {
                ContentUnavailableView(
                    "Bu koleksiyon boş",
                    systemImage: "rectangle.stack",
                    description: Text("İçine klasör, koleksiyon veya eser eklenebilir.")
                )
            }
        }
        .toolbar {
            ToolbarItem {
                Menu {
                    Button("Koleksiyon ekle") { add(.collection) }
                    Button("Klasör ekle") { add(.folder) }
                    Button("Eser ekle") { add(.document) }
                } label: {
                    Label("Ekle", systemImage: "plus")
                }
            }
        }
    }

    private func add(_ kind: LibraryItemKind) {
        let item = LibraryItem(
            parentID: container.id,
            title: kind == .document ? "Yeni Eser" : (kind == .folder ? "Yeni Klasör" : "Yeni Koleksiyon"),
            kind: kind,
            order: children.count
        )
        modelContext.insert(item)
    }
}
