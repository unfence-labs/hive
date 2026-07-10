import Foundation

enum AnsiColorToken: Equatable {
    case standard
    case indexed(Int)
}

struct AnsiSpan: Equatable {
    let text: String
    let color: AnsiColorToken
    let bold: Bool
}

struct AnsiLine: Identifiable, Equatable {
    let id: Int
    let spans: [AnsiSpan]

    var plainText: String {
        spans.map(\.text).joined()
    }
}

struct AnsiLogParser {
    static let maxLines = 2000

    private(set) var lines: [AnsiLine] = []
    private(set) var truncated = false

    private struct Cell: Equatable {
        var character: Character
        var color: AnsiColorToken
        var bold: Bool
    }

    private enum Mode {
        case text
        case escape
        case escapeIntermediate
        case csi
        case osc
    }

    private var mode: Mode = .text
    private var cells: [Cell] = []
    private var column = 0
    private var color: AnsiColorToken = .standard
    private var bold = false

    private var textBytes: [UInt8] = []
    private var controlBytes: [UInt8] = []
    private var oscSawEscape = false

    private var nextLineId = 0
    private var currentLineId: Int

    init() {
        currentLineId = 0
        nextLineId = 1
    }

    var pending: AnsiLine? {
        guard !cells.isEmpty else { return nil }
        return AnsiLine(id: currentLineId, spans: spans(from: cells))
    }

    mutating func reset() {
        lines = []
        truncated = false
        mode = .text
        cells = []
        column = 0
        color = .standard
        bold = false
        textBytes = []
        controlBytes = []
        oscSawEscape = false
        currentLineId = nextLineId
        nextLineId += 1
    }

    mutating func feed(_ data: Data) {
        for byte in data {
            consume(byte)
        }
    }

    mutating func feed(_ string: String) {
        feed(Data(string.utf8))
    }

    private mutating func consume(_ byte: UInt8) {
        switch mode {
        case .text:
            consumeText(byte)
        case .escape:
            consumeEscape(byte)
        case .escapeIntermediate:
            consumeEscapeIntermediate(byte)
        case .csi:
            consumeCSI(byte)
        case .osc:
            consumeOSC(byte)
        }
    }

    private mutating func consumeText(_ byte: UInt8) {
        switch byte {
        case 0x1B:
            flushTextBytes()
            mode = .escape
        case 0x0A:
            flushTextBytes()
            finishLine()
        case 0x0D:
            flushTextBytes()
            column = 0
        case 0x08:
            flushTextBytes()
            if column > 0 { column -= 1 }
        default:
            if byte == 0x09 {
                flushTextBytes()
                writeCharacter(" ")
            } else if byte < 0x20 {
                flushTextBytes()
            } else {
                textBytes.append(byte)
                if isUTF8Complete(textBytes) {
                    flushTextBytes()
                }
            }
        }
    }

    private mutating func consumeEscape(_ byte: UInt8) {
        switch byte {
        case 0x5B:
            controlBytes = []
            mode = .csi
        case 0x5D, 0x50, 0x58, 0x5E, 0x5F:
            oscSawEscape = false
            mode = .osc
        default:
            if byte >= 0x20 && byte <= 0x2F {
                mode = .escapeIntermediate
            } else {
                mode = .text
            }
        }
    }

    private mutating func consumeEscapeIntermediate(_ byte: UInt8) {
        if byte >= 0x20 && byte <= 0x2F {
            return
        }
        mode = .text
    }

    private mutating func consumeCSI(_ byte: UInt8) {
        if byte >= 0x40 && byte <= 0x7E {
            if byte == 0x6D {
                applySGR(controlBytes)
            } else if byte == 0x4B {
                applyEraseLine(controlBytes)
            } else if byte == 0x47 {
                applyCursorColumn(controlBytes)
            }
            controlBytes = []
            mode = .text
        } else {
            controlBytes.append(byte)
        }
    }

    private mutating func consumeOSC(_ byte: UInt8) {
        if byte == 0x07 {
            mode = .text
            oscSawEscape = false
        } else if oscSawEscape {
            oscSawEscape = false
            if byte == 0x5C {
                mode = .text
            }
        } else if byte == 0x1B {
            oscSawEscape = true
        }
    }

    private mutating func flushTextBytes() {
        guard !textBytes.isEmpty else { return }
        let text = String(decoding: textBytes, as: UTF8.self)
        textBytes = []
        for character in text {
            writeCharacter(character)
        }
    }

    private mutating func writeCharacter(_ character: Character) {
        let cell = Cell(character: character, color: color, bold: bold)
        if column < cells.count {
            cells[column] = cell
        } else {
            while cells.count < column {
                cells.append(Cell(character: " ", color: .standard, bold: false))
            }
            cells.append(cell)
        }
        column += 1
    }

    private mutating func finishLine() {
        let line = AnsiLine(id: currentLineId, spans: spans(from: cells))
        appendLine(line)
        cells = []
        column = 0
        currentLineId = nextLineId
        nextLineId += 1
    }

    private mutating func appendLine(_ line: AnsiLine) {
        lines.append(line)
        if lines.count > Self.maxLines {
            lines.removeFirst(lines.count - Self.maxLines)
            truncated = true
        }
    }

    private func spans(from cells: [Cell]) -> [AnsiSpan] {
        var spans: [AnsiSpan] = []
        var run = ""
        var runColor: AnsiColorToken = .standard
        var runBold = false

        for cell in cells {
            if run.isEmpty {
                runColor = cell.color
                runBold = cell.bold
                run.append(cell.character)
            } else if cell.color == runColor && cell.bold == runBold {
                run.append(cell.character)
            } else {
                spans.append(AnsiSpan(text: run, color: runColor, bold: runBold))
                run = String(cell.character)
                runColor = cell.color
                runBold = cell.bold
            }
        }
        if !run.isEmpty {
            spans.append(AnsiSpan(text: run, color: runColor, bold: runBold))
        }
        return spans
    }

    private mutating func applyEraseLine(_ bytes: [UInt8]) {
        let raw = String(decoding: bytes, as: UTF8.self)
        let param = raw.isEmpty ? 0 : (Int(raw) ?? 0)
        switch param {
        case 0:
            if column < cells.count {
                cells.removeSubrange(column..<cells.count)
            }
        case 1:
            let end = min(column + 1, cells.count)
            for index in 0..<end {
                cells[index] = Cell(character: " ", color: .standard, bold: false)
            }
        case 2:
            cells.removeAll()
        default:
            break
        }
    }

    private mutating func applyCursorColumn(_ bytes: [UInt8]) {
        let raw = String(decoding: bytes, as: UTF8.self)
        let param = raw.isEmpty ? 1 : (Int(raw) ?? 1)
        column = max(0, param - 1)
    }

    private mutating func applySGR(_ bytes: [UInt8]) {
        let raw = String(decoding: bytes, as: UTF8.self)
        let params = raw.isEmpty ? [0] : raw.split(separator: ";", omittingEmptySubsequences: false).map { Int($0) ?? 0 }

        var index = 0
        while index < params.count {
            let code = params[index]
            switch code {
            case 0:
                color = .standard
                bold = false
            case 1:
                bold = true
            case 22:
                bold = false
            case 30...37:
                color = .indexed(code - 30)
            case 90...97:
                color = .indexed(code - 90 + 8)
            case 39:
                color = .standard
            case 38, 48:
                if index + 1 < params.count, params[index + 1] == 5 {
                    index += 2
                } else if index + 1 < params.count, params[index + 1] == 2 {
                    index += 4
                }
                if code == 38 { color = .standard }
            default:
                break
            }
            index += 1
        }
    }

    private func isUTF8Complete(_ bytes: [UInt8]) -> Bool {
        guard let first = bytes.first else { return true }
        let expected: Int
        if first < 0x80 { expected = 1 }
        else if first & 0xE0 == 0xC0 { expected = 2 }
        else if first & 0xF0 == 0xE0 { expected = 3 }
        else if first & 0xF8 == 0xF0 { expected = 4 }
        else { return true }
        return bytes.count >= expected
    }
}
