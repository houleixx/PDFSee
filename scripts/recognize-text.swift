import Foundation
import Vision

struct RecognizedLine: Encodable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(text: String, bounds: CGRect) {
        self.text = text
        x = bounds.minX
        y = 1 - bounds.maxY
        width = bounds.width
        height = bounds.height
    }
}

do {
    let image = FileHandle.standardInput.readDataToEndOfFile()
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    try VNImageRequestHandler(data: image, options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> RecognizedLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return RecognizedLine(text: candidate.string, bounds: observation.boundingBox)
    }
    try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(lines))
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
