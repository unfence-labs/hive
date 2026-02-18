import SwiftUI

struct ChatInputBar: View {
    @Binding var draft: String
    let isBusy: Bool
    @Binding var thinkingEnabled: Bool
    @Binding var planModeEnabled: Bool
    @FocusState private var isDraftFocused: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // Mode toggles
            HStack(spacing: 4) {
                ModeToggle(systemImage: "brain", isActive: $thinkingEnabled)
                ModeToggle(systemImage: "doc.text", isActive: $planModeEnabled)
            }

            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($isDraftFocused)
                .submitLabel(.send)
                .onSubmit {
                    if canSend { onSend() }
                }
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    isDraftFocused = true
                }

            Button {
                onSend()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSend ? .accent : .secondary)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: .capsule)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }
}

// MARK: - Mode Toggle Button

private struct ModeToggle: View {
    let systemImage: String
    @Binding var isActive: Bool

    var body: some View {
        Button { isActive.toggle() } label: {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(isActive ? .accent : .secondary)
                .frame(width: 32, height: 32)
        }
    }
}

#Preview {
    VStack {
        Spacer()
        ChatInputBar(
            draft: .constant("Hello"),
            isBusy: false,
            thinkingEnabled: .constant(true),
            planModeEnabled: .constant(false)
        ) {}
        ChatInputBar(
            draft: .constant(""),
            isBusy: false,
            thinkingEnabled: .constant(false),
            planModeEnabled: .constant(false)
        ) {}
    }
    .padding()
    .preferredColorScheme(.dark)
}
