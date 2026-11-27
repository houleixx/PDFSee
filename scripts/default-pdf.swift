import AppKit
import UniformTypeIdentifiers

@main
struct DefaultPDF {
    @MainActor
    static func main() async {
        do {
            try await run()
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            exit(EXIT_FAILURE)
        }
    }

    @MainActor
    private static func run() async throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 3 else { throw CocoaError(.fileReadInvalidFileName) }

        let workspace = NSWorkspace.shared
        let applicationURL = URL(fileURLWithPath: arguments[2], isDirectory: true)
        guard let identifier = Bundle(url: applicationURL)?.bundleIdentifier else {
            throw CocoaError(.fileReadCorruptFile)
        }

        if arguments[1] == "set" {
            try await workspace.setDefaultApplication(at: applicationURL, toOpen: .pdf)
        }
        let defaultURL = workspace.urlForApplication(toOpen: .pdf)
        let defaultIdentifier = defaultURL.flatMap { Bundle(url: $0)?.bundleIdentifier }
        print(defaultIdentifier == identifier ? "default" : "other")
    }
}
