import AppKit
import CoreGraphics

enum ScaleMode {
    case custom, fit, fill
}

struct PrintOptions {
    var autoRotate = true
    var mode = ScaleMode.fit
    var percent = 100.0
    var copies = 1
}

final class PrintSettings: NSViewController, NSPrintPanelAccessorizing {
    private let chinese: Bool
    private(set) var options = PrintOptions()
    @objc dynamic private(set) var layoutRevision = 0

    private lazy var autoRotate = NSButton(checkboxWithTitle: label("自动旋转", "Auto Rotate"),
                                            target: self, action: #selector(updateSettings(_:)))
    private lazy var custom = radio("自定义缩放", "Custom Scale")
    private lazy var fit = radio("缩放以适合", "Scale to Fit")
    private lazy var entire = radio("完整打印", "Print Entire Page")
    private lazy var fill = radio("填满纸张", "Fill Paper")
    private var fitMode = ScaleMode.fit
    private lazy var percent = NSTextField(string: "100")
    private lazy var copies = NSPopUpButton(frame: .zero, pullsDown: false)
    private let copyCounts = Array(1...16)

    init(chinese: Bool) {
        self.chinese = chinese
        super.init(nibName: nil, bundle: nil)
        title = label("PDFSee 排版", "PDFSee Layout")
    }

    required init?(coder: NSCoder) { nil }

    private func label(_ chineseText: String, _ englishText: String) -> String {
        chinese ? chineseText : englishText
    }

    private func radio(_ chineseText: String, _ englishText: String) -> NSButton {
        NSButton(radioButtonWithTitle: label(chineseText, englishText), target: self, action: #selector(updateSettings(_:)))
    }

    override func loadView() {
        autoRotate.state = .on
        copies.addItems(withTitles: copyCounts.map(String.init))
        for control in [percent, copies] {
            control.target = self
            control.action = #selector(updateSettings(_:))
        }
        let formatter = NumberFormatter()
        formatter.minimum = 1
        formatter.maximum = 1000
        formatter.maximumFractionDigits = 2
        formatter.allowsFloats = true
        percent.formatter = formatter
        percent.doubleValue = 100
        percent.alignment = .right
        percent.setAccessibilityLabel(label("缩放比例", "Scale percentage"))
        percent.widthAnchor.constraint(equalToConstant: 78).isActive = true
        let percentField = NSStackView(views: [percent, NSTextField(labelWithString: "%")])
        percentField.spacing = 5
        percentField.alignment = .firstBaseline

        let fitChoices = NSStackView(views: [entire, fill])
        fitChoices.orientation = .vertical
        fitChoices.alignment = .leading
        fitChoices.spacing = 8
        let copiesLabel = NSTextField(labelWithString: label("每页份数", "Copies per Page"))
        let grid = NSGridView(views: [[custom, percentField], [fit, fitChoices], [copiesLabel, copies]])
        grid.column(at: 0).width = 176
        grid.column(at: 1).width = 250
        grid.columnSpacing = 16
        grid.rowSpacing = 12
        grid.xPlacement = .leading
        grid.yPlacement = .top
        grid.row(at: 2).topPadding = 9
        let stack = NSStackView(views: [autoRotate, grid])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        view = stack
        syncScaleControls()
    }

    private func syncScaleControls() {
        let customScale = options.mode == .custom
        custom.state = customScale ? .on : .off
        fit.state = customScale ? .off : .on
        entire.state = !customScale && fitMode == .fit ? .on : .off
        fill.state = !customScale && fitMode == .fill ? .on : .off
        percent.isEnabled = customScale
    }

    @objc private func updateSettings(_ sender: NSControl) {
        options.autoRotate = autoRotate.state == .on
        if sender === entire { fitMode = .fit }
        if sender === fill { fitMode = .fill }
        if sender === custom { options.mode = .custom }
        if sender === fit || sender === entire || sender === fill { options.mode = fitMode }
        options.percent = min(1000, max(1, percent.doubleValue))
        options.copies = max(1, copies.indexOfSelectedItem + 1)
        syncScaleControls()
        layoutRevision += 1
    }

    func keyPathsForValuesAffectingPreview() -> Set<String> { ["layoutRevision"] }

    func localizedSummaryItems() -> [[NSPrintPanel.AccessorySummaryKey: String]] {
        let scale: String
        switch options.mode {
        case .custom: scale = "\(options.percent.formatted())%"
        case .fit: scale = label("完整打印", "Print Entire Page")
        case .fill: scale = label("填满纸张", "Fill Paper")
        }
        return [
            [.itemName: label("自动旋转", "Auto Rotate"),
             .itemDescription: options.autoRotate ? label("开", "On") : label("关", "Off")],
            [.itemName: label("缩放方式", "Scaling"),
             .itemDescription: scale],
            [.itemName: label("每页份数", "Copies per Page"), .itemDescription: String(options.copies)]
        ]
    }
}

struct PrintLayout {
    let cells: [CGRect]
    let rotation: Int
    let scale: CGFloat

    init(page: CGSize, sheet: CGSize, options: PrintOptions) {
        let gap: CGFloat = options.copies > 1 ? min(8, min(sheet.width, sheet.height) / 40) : 0
        var bestFit: CGFloat = -1
        var columns = 1
        var rows = options.copies
        var cell = CGSize.zero
        var rotate = false

        for candidate in 1...options.copies {
            let rowCount = (options.copies + candidate - 1) / candidate
            let width = (sheet.width - gap * CGFloat(candidate - 1)) / CGFloat(candidate)
            let height = (sheet.height - gap * CGFloat(rowCount - 1)) / CGFloat(rowCount)
            let fit = min(width / page.width, height / page.height)
            let rotatedFit = min(width / page.height, height / page.width)
            let shouldRotate = options.autoRotate && rotatedFit > fit + 0.00001
            let score = shouldRotate ? rotatedFit : fit
            if score > bestFit {
                bestFit = score
                columns = candidate
                rows = rowCount
                cell = CGSize(width: width, height: height)
                rotate = shouldRotate
            }
        }

        rotation = rotate ? 90 : 0
        switch options.mode {
        case .custom: scale = options.percent / 100
        case .fit: scale = bestFit
        case .fill:
            scale = max(cell.width / (rotate ? page.height : page.width),
                        cell.height / (rotate ? page.width : page.height))
        }
        cells = (0..<options.copies).map { index in
            let row = index / columns
            let rowCopies = min(columns, options.copies - row * columns)
            let rowWidth = CGFloat(rowCopies) * cell.width + CGFloat(rowCopies - 1) * gap
            return CGRect(x: (sheet.width - rowWidth) / 2 + CGFloat(index % columns) * (cell.width + gap),
                          y: CGFloat(rows - row - 1) * (cell.height + gap),
                          width: cell.width, height: cell.height)
        }
    }
}

final class PrintView: NSView {
    private let document: CGPDFDocument
    private let settings: PrintSettings
    weak var operation: NSPrintOperation?

    init(document: CGPDFDocument, settings: PrintSettings) {
        self.document = document
        self.settings = settings
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { nil }

    private var printInfo: NSPrintInfo { operation?.printInfo ?? .shared }

    private var sheetBounds: CGRect {
        let size = printInfo.paperSize
        return CGRect(x: 0, y: 0, width: max(1, size.width), height: max(1, size.height))
    }

    private var layoutBounds: CGRect {
        let paper = sheetBounds
        if settings.options.mode == .fill { return paper }
        let imageable = paper.intersection(printInfo.imageablePageBounds)
        return imageable.isEmpty ? paper : imageable
    }

    override func knowsPageRange(_ range: NSRangePointer) -> Bool {
        let size = sheetBounds.size
        setFrameSize(CGSize(width: size.width, height: size.height * CGFloat(document.numberOfPages)))
        range.pointee = NSRange(location: 1, length: document.numberOfPages)
        return true
    }

    override func rectForPage(_ page: Int) -> NSRect {
        let size = sheetBounds.size
        return CGRect(x: 0, y: CGFloat(page - 1) * size.height, width: size.width, height: size.height)
    }

    override func locationOfPrintRect(_ rect: NSRect) -> NSPoint { .zero }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let size = sheetBounds.size
        let area = layoutBounds
        let first = max(1, Int(floor(dirtyRect.minY / size.height)) + 1)
        let last = min(document.numberOfPages, Int(ceil(dirtyRect.maxY / size.height)))
        guard first <= last else { return }
        for number in first...last {
            guard let page = document.page(at: number) else { continue }
            let box = page.getBoxRect(.mediaBox)
            let sideways = (page.rotationAngle % 180) != 0
            let pageSize = sideways ? CGSize(width: box.height, height: box.width) : box.size
            let sheet = rectForPage(number)
            let layout = PrintLayout(page: pageSize, sheet: area.size, options: settings.options)
            let rotate = layout.rotation != 0
            let content = CGRect(x: 0, y: 0, width: rotate ? pageSize.height : pageSize.width,
                                 height: rotate ? pageSize.width : pageSize.height)
            let transform = page.getDrawingTransform(.mediaBox, rect: content,
                rotate: Int32(layout.rotation), preserveAspectRatio: true)
            for cell in layout.cells {
                let clip = cell.offsetBy(dx: sheet.minX + area.minX, dy: sheet.minY + area.minY)
                context.saveGState()
                context.clip(to: clip)
                context.translateBy(x: clip.midX - content.width * layout.scale / 2,
                                    y: clip.midY - content.height * layout.scale / 2)
                context.scaleBy(x: layout.scale, y: layout.scale)
                context.concatenate(transform)
                context.drawPDFPage(page)
                context.restoreGState()
            }
        }
    }
}

let arguments = CommandLine.arguments
guard arguments.count >= 4,
      let document = CGPDFDocument(URL(fileURLWithPath: arguments[1]) as CFURL),
      document.numberOfPages > 0 else { exit(1) }

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let settings = PrintSettings(chinese: arguments[3] == "zh-CN")
let printView = PrintView(document: document, settings: settings)
let operation = NSPrintOperation(view: printView, printInfo: .shared)
printView.operation = operation
operation.printInfo.leftMargin = 0
operation.printInfo.rightMargin = 0
operation.printInfo.topMargin = 0
operation.printInfo.bottomMargin = 0
operation.printInfo.scalingFactor = 1
operation.printInfo.horizontalPagination = .clip
operation.printInfo.verticalPagination = .clip
operation.jobTitle = arguments[2]
operation.printPanel.options.formUnion([
    .showsCopies, .showsPageRange, .showsPaperSize, .showsOrientation, .showsPreview
])
operation.printPanel.options.remove(.showsScaling)
operation.printPanel.addAccessoryController(settings)
application.activate(ignoringOtherApps: true)
exit(operation.run() ? 0 : 2)
