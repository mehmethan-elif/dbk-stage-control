#!/usr/bin/env swift

// Draws the home screen icons for both roles at the sizes Android asks for. The original pair was
// hand made at 180x180, which iOS is happy with but Chrome upscales into a blurry mess, so the
// artwork is described here as fractions of the canvas and redrawn crisp at any size. The numbers
// below were measured off the original icon-stage.png so the new sizes sit next to the old ones
// without looking redrawn.
//
// Run with: npm run icons

import AppKit

let bg = NSColor(srgbRed: 0x14 / 255, green: 0x14 / 255, blue: 0x14 / 255, alpha: 1)
let ink = NSColor(srgbRed: 0xF5 / 255, green: 0xF2 / 255, blue: 0xEE / 255, alpha: 1)

struct Role {
    let slug: String
    let word: String
    let wordWidth: Double // fraction of the canvas, measured from the original
    let accent: NSColor
}

let roles = [
    Role(slug: "stage", word: "STAGE", wordWidth: 98.0 / 180,
         accent: NSColor(srgbRed: 0xE0 / 255, green: 0x53 / 255, blue: 0x3D / 255, alpha: 1)),
    Role(slug: "practice", word: "PRACTICE", wordWidth: 129.0 / 180,
         accent: NSColor(srgbRed: 0x4A / 255, green: 0x90 / 255, blue: 0xC2 / 255, alpha: 1))
]

// Fractions of the canvas, measured from the 180px original.
let stripeHeight = 8.0 / 180
let markCapTop = 49.0 / 180
let markCapHeight = 45.0 / 180
let markWidth = 135.0 / 180
let wordCapTop = 113.0 / 180
let wordCapHeight = 20.0 / 180
// Letterspacing on top of the font's own, as a fraction of cap height, tuned until the rendered
// gaps matched the 8px and 4px the original leaves between letters.
let markGap = 0.05
let wordGap = 0.16

/// A line of text sized by its cap height rather than its point size, because the original was laid
/// out by eye against the canvas edges and cap height is what the eye actually measures.
func line(_ text: String, font name: String, capHeight: CGFloat, tracking: CGFloat, color: NSColor) -> (CTLine, CGFloat) {
    let probe = NSFont(name: name, size: 100) ?? NSFont.boldSystemFont(ofSize: 100)
    let size = capHeight * 100 / probe.capHeight
    let font = NSFont(name: name, size: size) ?? NSFont.boldSystemFont(ofSize: size)
    let attributed = NSAttributedString(string: text, attributes: [
        .font: font,
        .foregroundColor: color,
        .kern: tracking
    ])
    let ctLine = CTLineCreateWithAttributedString(attributed)
    var width = CTLineGetTypographicBounds(ctLine, nil, nil, nil)
    width -= tracking // the kern after the last glyph is not part of the visible run
    return (ctLine, CGFloat(width))
}

/// Draws a line letterspaced by `gap` and squeezed horizontally to land on `width`.
///
/// Both parts matter. The original artwork is set in something narrower than Helvetica, so asking
/// Helvetica to fill the same width at the same cap height makes the glyphs collide; and simply
/// shrinking it would leave the lettering too small against the canvas. Keeping the gaps honest and
/// condensing the glyphs to fit reproduces what the original actually looks like.
func place(
    _ text: String,
    font name: String,
    capHeight: CGFloat,
    gap: CGFloat,
    width: CGFloat,
    color: NSColor,
    in context: CGContext,
    baseline: CGFloat,
    canvas: CGFloat
) {
    let (drawn, natural) = line(text, font: name, capHeight: capHeight, tracking: gap * capHeight, color: color)
    context.saveGState()
    context.translateBy(x: (canvas - width) / 2, y: baseline)
    context.scaleBy(x: width / natural, y: 1)
    context.textPosition = .zero
    CTLineDraw(drawn, context)
    context.restoreGState()
}

func draw(role: Role, size: Int, maskable: Bool, to url: URL) throws {
    let side = CGFloat(size)
    guard let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { throw CocoaError(.fileWriteUnknown) }

    context.setFillColor(bg.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: side, height: side))

    let previous = NSGraphicsContext.current
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    defer { NSGraphicsContext.current = previous }

    // Android masks the icon to a circle of 80% diameter, so the maskable variant loses the edge
    // stripe and pulls the lettering in far enough to survive the crop. The role word carries the
    // colour on its own, which is why dropping the stripe still reads as the right icon.
    let scale: CGFloat = maskable ? 0.86 : 1

    if !maskable {
        context.setFillColor(role.accent.cgColor)
        context.fill(CGRect(x: 0, y: side - stripeHeight * side, width: side, height: stripeHeight * side))
    }

    // The source art hangs the lettering off the top edge, which only works when the stripe is
    // there to balance it. Without the stripe the block has to sit in the middle of the circle, so
    // the maskable variant re-centres it. Positive values push the content down the canvas.
    let contentHeight = (wordCapTop + wordCapHeight - markCapTop) * side * scale
    let contentShift = maskable ? (side - contentHeight) / 2 - markCapTop * side * scale : 0

    place(
        "DBK",
        font: "HelveticaNeue-Bold",
        capHeight: markCapHeight * side * scale,
        gap: markGap,
        width: markWidth * side * scale,
        color: ink,
        in: context,
        baseline: side - (markCapTop + markCapHeight) * side * scale - contentShift,
        canvas: side
    )

    place(
        role.word,
        font: "HelveticaNeue-Medium",
        capHeight: wordCapHeight * side * scale,
        gap: wordGap,
        width: role.wordWidth * side * scale,
        color: role.accent,
        in: context,
        baseline: side - (wordCapTop + wordCapHeight) * side * scale - contentShift,
        canvas: side
    )

    guard let image = context.makeImage(),
          let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else { throw CocoaError(.fileWriteUnknown) }
    try data.write(to: url)
    print("  \(url.lastPathComponent)")
}

let out = URL(fileURLWithPath: "apps/web/public")
print("icons ->")
for role in roles {
    for size in [192, 512] {
        try draw(role: role, size: size, maskable: false, to: out.appendingPathComponent("icon-\(role.slug)-\(size).png"))
    }
    try draw(role: role, size: 512, maskable: true, to: out.appendingPathComponent("icon-\(role.slug)-maskable-512.png"))
}
