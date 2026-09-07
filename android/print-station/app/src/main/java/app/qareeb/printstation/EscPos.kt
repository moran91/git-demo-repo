package app.qareeb.printstation

import android.graphics.Bitmap
import android.graphics.Color

/** ESC/POS raster encoding (GS v 0) with bounded strips. Cash-drawer commands are never emitted. */
object EscPos {
    private const val ESC = 0x1b.toByte()
    private const val GS = 0x1d.toByte()

    fun init(): ByteArray = byteArrayOf(ESC, 0x40)
    fun feed(lines: Int): ByteArray = byteArrayOf(ESC, 0x64, lines.coerceIn(0, 255).toByte())
    fun cut(): ByteArray = byteArrayOf(GS, 0x56, 0x42, 0x00)

    /** Splits a bitmap into raster strips of at most [maxRows] rows, thresholded to 1-bit. */
    fun strips(bmp: Bitmap, maxRows: Int): List<ByteArray> {
        val out = mutableListOf<ByteArray>()
        val bytesPerRow = (bmp.width + 7) / 8
        var y0 = 0
        while (y0 < bmp.height) {
            val h = minOf(maxRows, bmp.height - y0)
            val data = ByteArray(bytesPerRow * h)
            val px = IntArray(bmp.width * h)
            bmp.getPixels(px, 0, bmp.width, 0, y0, bmp.width, h)
            for (y in 0 until h) for (x in 0 until bmp.width) {
                val c = px[y * bmp.width + x]
                val lum = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000
                if (lum < 160) data[y * bytesPerRow + (x shr 3)] = (data[y * bytesPerRow + (x shr 3)].toInt() or (0x80 shr (x and 7))).toByte()
            }
            val header = byteArrayOf(GS, 0x76, 0x30, 0x00, (bytesPerRow and 0xff).toByte(), ((bytesPerRow shr 8) and 0xff).toByte(), (h and 0xff).toByte(), ((h shr 8) and 0xff).toByte())
            out += header + data
            y0 += h
        }
        return out
    }
}
