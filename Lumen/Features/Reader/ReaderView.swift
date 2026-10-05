import SwiftUI
import SwiftData

struct ReaderView: View {
    let document: LibraryItem

    @Query(sort: \ContentSegment.order) private var allSegments: [ContentSegment]

    private var segments: [ContentSegment] {
        allSegments
            .filter { $0.documentID == document.id }
            .sorted { $0.order < $1.order }
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(segments) { segment in
                        SegmentView(segment: segment)
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding()
                .frame(maxWidth: .infinity)
            }

            FloatingPlaybackButton()
                .padding()
        }
        .overlay {
            if segments.isEmpty {
                ContentUnavailableView(
                    "İçerik yok",
                    systemImage: "doc.text",
                    description: Text("İçerik daha sonra içe aktarılabilir veya oluşturulabilir.")
                )
            }
        }
    }
}

private struct SegmentView: View {
    let segment: ContentSegment

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !segment.title.isEmpty {
                Text(segment.title)
                    .font(.headline)
            }

            if !segment.text.isEmpty {
                Text(segment.text)
                    .font(.body)
                    .textSelection(.enabled)
            }

            if !segment.secondaryText.isEmpty {
                Text(segment.secondaryText)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if !segment.translation.isEmpty {
                Text(segment.translation)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
