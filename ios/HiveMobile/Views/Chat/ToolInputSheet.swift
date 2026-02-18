import MarkdownUI
import SwiftUI

struct ToolInputSheet: View {
    let pendingInputs: [PendingToolInput]
    let onRespond: (PendingToolInput, ToolInputResult) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if let askQuestion = pendingInputs.first(where: { $0.toolName == "AskUserQuestion" }) {
                    AskUserQuestionView(
                        allInputs: pendingInputs.filter { $0.toolName == "AskUserQuestion" },
                        onRespond: onRespond
                    )
                } else if let planMode = pendingInputs.first(where: { $0.toolName == "ExitPlanMode" }) {
                    ExitPlanModeView(pending: planMode, onRespond: onRespond)
                } else {
                    Text("Unknown tool input")
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
    let allInputs: [PendingToolInput]
    let onRespond: (PendingToolInput, ToolInputResult) -> Void

    @State private var flatQuestions: [FlatQuestion] = []
    @State private var drafts: [String: AnswerDraft] = [:]
    @State private var currentIndex = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let current = currentQuestion {
                    questionView(current)

                    // Navigation + submit
                    HStack {
                        if flatQuestions.count > 1 {
                            Button {
                                currentIndex = max(0, currentIndex - 1)
                            } label: {
                                Image(systemName: "chevron.left")
                            }
                            .disabled(currentIndex == 0)

                            Text("\(currentIndex + 1)/\(flatQuestions.count)")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Button {
                                currentIndex = min(flatQuestions.count - 1, currentIndex + 1)
                            } label: {
                                Image(systemName: "chevron.right")
                            }
                            .disabled(currentIndex == flatQuestions.count - 1)

                            Spacer()
                        }

                        if currentIndex < flatQuestions.count - 1 {
                            Button("Next") {
                                currentIndex += 1
                            }
                            .buttonStyle(.glassProminent)
                        } else {
                            Button("Submit") {
                                submit()
                            }
                            .buttonStyle(.glassProminent)
                            .disabled(!hasAnyAnswer)
                        }
                    }
                    .padding(.top, 8)
                }
            }
            .padding()
        }
        .navigationTitle("Question")
        .onAppear { parseAllQuestions() }
    }

    private var currentQuestion: FlatQuestion? {
        currentIndex < flatQuestions.count ? flatQuestions[currentIndex] : nil
    }

    private var hasAnyAnswer: Bool {
        drafts.values.contains { !$0.selectedOptions.isEmpty || !$0.customText.isEmpty }
    }

    private func questionView(_ fq: FlatQuestion) -> some View {
        let draft = drafts[fq.key] ?? AnswerDraft()
        return VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            Text(fq.question.question)
                .font(.subheadline)
                .bold()

            ForEach(Array(fq.question.options.enumerated()), id: \.offset) { optIdx, option in
                let isSelected = draft.selectedOptions.contains(optIdx)
                Button {
                    toggleOption(fq: fq, optionIndex: optIdx)
                } label: {
                    HStack {
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(isSelected ? .accent : .secondary)
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
                    .padding(HiveSpacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(isSelected ? Color.white.opacity(0.06) : Color.white.opacity(0.02))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(isSelected ? WhisperColor.border : WhisperColor.borderSubtle, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }

            TextField("Type something...", text: customTextBinding(for: fq), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...3)
        }
    }

    private func toggleOption(fq: FlatQuestion, optionIndex: Int) {
        var draft = drafts[fq.key] ?? AnswerDraft()
        let isMulti = fq.question.multiSelect ?? false
        if isMulti {
            if let idx = draft.selectedOptions.firstIndex(of: optionIndex) {
                draft.selectedOptions.remove(at: idx)
            } else {
                draft.selectedOptions.append(optionIndex)
            }
        } else {
            draft.selectedOptions = draft.selectedOptions == [optionIndex] ? [] : [optionIndex]
        }
        drafts[fq.key] = draft
    }

    private func customTextBinding(for fq: FlatQuestion) -> Binding<String> {
        Binding(
            get: { drafts[fq.key]?.customText ?? "" },
            set: {
                var draft = drafts[fq.key] ?? AnswerDraft()
                draft.customText = $0
                drafts[fq.key] = draft
            }
        )
    }

    private func parseAllQuestions() {
        var result: [FlatQuestion] = []
        for pending in allInputs {
            guard let data = pending.input.data(using: .utf8),
                  let payload = try? JSONDecoder().decode(ToolInputPayload.self, from: data) else {
                continue
            }
            for (i, q) in payload.questions.enumerated() {
                result.append(FlatQuestion(
                    pending: pending,
                    questionIndex: i,
                    question: q,
                    originalQuestions: payload.questions
                ))
            }
        }
        flatQuestions = result
    }

    private func submit() {
        // Group answers by pending tool input, matching frontend's batchAnswerQuestions
        var grouped: [String: (pending: PendingToolInput, answers: [QuestionAnswer], questions: [Question])] = [:]

        for fq in flatQuestions {
            let draft = drafts[fq.key] ?? AnswerDraft()
            guard !draft.selectedOptions.isEmpty || !draft.customText.isEmpty else { continue }

            let answer = QuestionAnswer(
                questionIndex: fq.questionIndex,
                selectedOptions: draft.selectedOptions,
                customText: draft.customText.isEmpty ? nil : draft.customText
            )

            if grouped[fq.pending.requestId] == nil {
                grouped[fq.pending.requestId] = (
                    pending: fq.pending,
                    answers: [],
                    questions: fq.originalQuestions
                )
            }
            grouped[fq.pending.requestId]?.answers.append(answer)
        }

        for (_, entry) in grouped {
            let questionInputs = entry.questions.map { q in
                QuestionInput(
                    question: q.question,
                    options: q.options,
                    multiSelect: q.multiSelect
                )
            }
            onRespond(entry.pending, .answer(answers: entry.answers, questions: questionInputs))
        }
    }
}

private struct FlatQuestion {
    let pending: PendingToolInput
    let questionIndex: Int
    let question: Question
    let originalQuestions: [Question]

    var key: String { "\(pending.requestId)-\(questionIndex)" }
}

private struct AnswerDraft {
    var selectedOptions: [Int] = []
    var customText: String = ""
}

private struct ToolInputPayload: Decodable {
    let questions: [Question]
}

// MARK: - ExitPlanMode

private struct ExitPlanModeView: View {
    let pending: PendingToolInput
    let onRespond: (PendingToolInput, ToolInputResult) -> Void
    @State private var rejectMessage = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HiveSpacing.lg) {
                Text("Plan Proposal")
                    .font(.headline)

                Markdown(pending.input)
                    .markdownTheme(.planProposal)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(HiveSpacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.03))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(WhisperColor.borderSubtle, lineWidth: 1)
                    )

                HStack(spacing: 12) {
                    Button {
                        onRespond(pending, .approve)
                    } label: {
                        Text("Approve")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.green)

                    Button {
                        let msg = rejectMessage.isEmpty ? nil : rejectMessage
                        onRespond(pending, .reject(message: msg))
                    } label: {
                        Text("Reject")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
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

// MARK: - Plan Proposal Markdown Theme

private extension Theme {
    static let planProposal = Theme.gitHub
        .text {
            BackgroundColor(.clear)
            ForegroundColor(Color(red: 0.91, green: 0.91, blue: 0.94))
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(13)
            BackgroundColor(Color.white.opacity(0.05))
        }
}
