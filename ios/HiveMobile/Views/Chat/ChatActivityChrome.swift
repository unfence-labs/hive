import SwiftUI

struct ToolContentPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WhisperColor.surface, in: RoundedRectangle(cornerRadius: 8))
            .padding(.top, 2)
    }
}
