import SwiftUI

struct FloatingPlaybackButton: View {
    @State private var isPlaying = false
    @State private var showControls = false
    @State private var repeatTarget = 10
    @State private var playbackRate = 1.0

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            if showControls {
                HStack(spacing: 12) {
                    Stepper("Tekrar: \(repeatTarget)", value: $repeatTarget, in: 1...999)
                        .frame(minWidth: 150)

                    Picker("Hız", selection: $playbackRate) {
                        Text("0.5×").tag(0.5)
                        Text("0.75×").tag(0.75)
                        Text("1×").tag(1.0)
                        Text("1.25×").tag(1.25)
                        Text("1.5×").tag(1.5)
                        Text("2×").tag(2.0)
                    }
                    .pickerStyle(.menu)
                }
                .padding(12)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .shadow(radius: 8)
            }

            Button {
                isPlaying.toggle()
            } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .frame(width: 58, height: 58)
                        .background(.blue, in: Circle())
                        .foregroundStyle(.white)

                    Text("\(repeatTarget)")
                        .font(.caption2.bold())
                        .padding(4)
                        .background(.background, in: Circle())
                        .offset(x: 4, y: -4)
                }
            }
            .buttonStyle(.plain)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.45)
                    .onEnded { _ in showControls.toggle() }
            )
            .accessibilityLabel(isPlaying ? "Duraklat" : "Oynat")
        }
    }
}
