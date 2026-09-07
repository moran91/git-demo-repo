package app.qareeb.printstation

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint

/**
 * Renders the receipt model into a 1-bit bitmap using Android's text stack (which shapes Arabic and
 * lays out bidi correctly) with the bundled Noto fonts. Mirrors the layout constants of the shared
 * TypeScript renderer so browser and station output match the same fixtures.
 */
class ReceiptRenderer(context: Context) {
    private val regular: Typeface = Typeface.createFromAsset(context.assets, "fonts/NotoSansHebrew-Regular.ttf")
    private val bold: Typeface = Typeface.createFromAsset(context.assets, "fonts/NotoSansHebrew-SemiBold.ttf")
    private val padding = 8
    private val sizes = mapOf("sm" to 20f, "md" to 24f, "lg" to 30f, "xl" to 40f)

    private fun paint(size: String, isBold: Boolean) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = if (isBold) bold else regular
        textSize = sizes[size] ?: 24f
        color = Color.BLACK
    }

    private fun layout(text: String, p: TextPaint, width: Int, align: Layout.Alignment, rtl: Boolean): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, p, width)
            .setAlignment(align)
            .setTextDirection(if (rtl) TextDirectionHeuristics.FIRSTSTRONG_RTL else TextDirectionHeuristics.FIRSTSTRONG_LTR)
            .setLineSpacing(0f, 1.35f)
            .setIncludePad(false)
            .build()

    fun render(model: ReceiptModel): Bitmap {
        val width = model.printableDots
        val content = width - padding * 2
        val rtl = model.rtl
        // Pass 1: measure.
        data class Placed(val height: Int, val draw: (Canvas, Int) -> Unit)
        val placed = mutableListOf<Placed>()
        for (b in model.blocks) {
            when (b) {
                is Block.Text -> {
                    val p = paint(b.size, b.bold)
                    val align = when (b.align) { "center" -> Layout.Alignment.ALIGN_CENTER; "end" -> Layout.Alignment.ALIGN_OPPOSITE; else -> Layout.Alignment.ALIGN_NORMAL }
                    val l = layout(b.text, p, content, align, if (b.dir == "ltr") false else if (b.dir == "rtl") true else rtl)
                    placed += Placed(l.height) { c, y -> c.save(); c.translate(padding.toFloat(), y.toFloat()); l.draw(c); c.restore() }
                }
                is Block.Row -> {
                    val p = paint(b.size, b.bold)
                    val endW = p.measureText(b.end).toInt()
                    val startW = (content - endW - 12).coerceAtLeast(60)
                    val l = layout(b.start, p, startW, Layout.Alignment.ALIGN_NORMAL, rtl)
                    placed += Placed(l.height) { c, y ->
                        c.save(); c.translate(if (rtl) (width - padding - startW).toFloat() else padding.toFloat(), y.toFloat()); l.draw(c); c.restore()
                        if (b.end.isNotEmpty()) {
                            val x = if (rtl) padding.toFloat() else (width - padding - endW).toFloat()
                            c.drawText(b.end, x, y + p.textSize, p)
                        }
                    }
                }
                is Block.Rule -> placed += Placed(14) { c, y ->
                    val p = Paint().apply { color = Color.BLACK; strokeWidth = 2f; if (b.dashed) pathEffect = DashPathEffect(floatArrayOf(6f, 4f), 0f) }
                    c.drawLine(padding.toFloat(), y + 6f, (width - padding).toFloat(), y + 6f, p)
                }
                is Block.Spacer -> placed += Placed(b.px) { _, _ -> }
                is Block.Box -> {
                    val inner = content - 20
                    val tp = paint("sm", true)
                    val bp = paint(b.size, b.bold)
                    val title = b.title?.let { layout(it, tp, inner, Layout.Alignment.ALIGN_NORMAL, rtl) }
                    val body = b.lines.map { layout(it, bp, inner, Layout.Alignment.ALIGN_NORMAL, rtl) }
                    val h = 10 + (title?.height ?: 0) + body.sumOf { it.height } + 10
                    placed += Placed(h + 6) { c, y ->
                        c.drawRect(padding + 1f, y + 1f, (width - padding - 1).toFloat(), y + h - 1f, Paint().apply { style = Paint.Style.STROKE; strokeWidth = 3f; color = Color.BLACK })
                        var yy = y + 8
                        c.save(); c.translate(padding + 10f, yy.toFloat()); title?.draw(c); c.restore()
                        yy += title?.height ?: 0
                        for (l in body) { c.save(); c.translate(padding + 10f, yy.toFloat()); l.draw(c); c.restore(); yy += l.height }
                    }
                }
            }
        }
        val height = placed.sumOf { it.height } + 24
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)
        var y = 8
        for (p in placed) { p.draw(canvas, y); y += p.height }
        return bmp
    }
}
