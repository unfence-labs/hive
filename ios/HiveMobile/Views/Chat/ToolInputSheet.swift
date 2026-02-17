import SwiftUI

struct ToolInputSheet: View {
    let pending: PendingToolInput
    let onRespond: (ToolInputResult) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if pending.toolName == "AskUserQuestion" {
                    AskUserQuestionView(input: pending.input, onRespond: onRespond)
                } else if pending.toolName == "ExitPlanMode" {
                    ExitPlanModeView(input: pending.input, onRespond: onRespond)
                } else {
                    Text("Unknown tool: \(pending.toolName)")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - AskUserQuestion

private struct AskUserQuestionView: View {
    let input: String
    let onRespond: (ToolInputResult) -> Void

    @State private var questions: [Question] = []
    @State private var selections: [[Int]] = []
    @State private var customTexts: [String] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(Array(questions.enumerated()), id: \.offset) { idx, question in
                    questionView(question, index: idx)
                }

                Button {
                    submit()
                } label: {
                    Text("Submit")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 8)
            }
            .padding()
        }
        .navigationTitle("Question")
        .onAppear { parseQuestions() }
    }

    private func questionView(_ question: Question, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(question.question)
                .font(.subheadline)
                .bold()

            ForEach(Array(question.options.enumerated()), id: \.offset) { optIdx, option in
                Button {
                    toggleOption(questionIndex: index, optionIndex: optIdx, multiSelect: question.multiSelect ?? false)
                } label: {
                    HStack {
                        Image(systemName: isSelected(index, optIdx) ? "checkmark.circle.fill" : "circle")
                        VStack(alignment: .leading) {
                            Text(option.label)
                            if let desc = option.description {
                                Text(desc)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            TextField("Additional context...", text: binding(for: index), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...3)
        }
    }

    private func isSelected(_ q: Int, _ o: Int) -> Bool {
        guard q < selections.count else { return false }
        return selections[q].contains(o)
    }

    private func toggleOption(questionIndex: Int, optionIndex: Int, multiSelect: Bool) {
        guard questionIndex < selections.count else { return }
        if multiSelect {
            if let idx = selections[questionIndex].firstIndex(of: optionIndex) {
                selections[questionIndex].remove(at: idx)
            } else {
                selections[questionIndex].append(optionIndex)
            }
        } else {
            selections[questionIndex] = [optionIndex]
        }
    }

    private func binding(for index: Int) -> Binding<String> {
        Binding(
            get: { index < customTexts.count ? customTexts[index] : "" },
            set: { if index < customTexts.count { customTexts[index] = $0 } }
        )
    }

    private func parseQuestions() {
        guard let data = input.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(ToolInputPayload.self, from: data) else { return }
        questions = parsed.questions
        selections = Array(repeating: [], count: questions.count)
        customTexts = Array(repeating: "", count: questions.count)
    }

    private func submit() {
        var answers: [QuestionAnswer] = []
        for (i, _) in questions.enumerated() {
            let selected = i < selections.count ? selections[i] : []
            let text = i < customTexts.count && !customTexts[i].isEmpty ? customTexts[i] : nil
            answers.append(QuestionAnswer(
                questionIndex: i, selectedOptions: selected, customText: text
            ))
        }
        onRespond(.answer(answers: answers, questions: nil))
    }
}

private struct ToolInputPayload: Decodable {
    let questions: [Question]
}

// MARK: - ExitPlanMode

private struct ExitPlanModeView: View {
    let input: String
    let onRespond: (ToolInputResult) -> Void
    @State private var rejectMessage = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Plan Proposal")
                    .font(.headline)

                Text(LocalizedStringKey(input))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)

                HStack(spacing: 12) {
                    Button {
                        onRespond(.approve)
                    } label: {
                        Text("Approve")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)

                    Button {
                        let msg = rejectMessage.isEmpty ? nil : rejectMessage
                        onRespond(.reject(message: msg))
                    } label: {
                        Text("Reject")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }

                TextField("Feedback (optional)...", text: $rejectMessage, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...3)
            }
            .padding()
        }
        .navigationTitle("Plan")
    }
}
