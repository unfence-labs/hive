import SwiftUI

struct ChatInputBar: View {
    @Binding var draft: String
    let isBusy: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .textFieldStyle(.plain)

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

#Preview {
    VStack {
        Spacer()
        ChatInputBar(draft: .constant("Hello"), isBusy: false) {}
        ChatInputBar(draft: .constant(""), isBusy: false) {}
        ChatInputBar(draft: .constant("Working..."), isBusy: true) {}
    }
    .padding()
    .preferredColorScheme(.dark)
}
