package app.qareeb.printstation

import org.json.JSONObject

/**
 * Receipt model consumed from the print job (same JSON contract as packages/shared receipt/model.ts).
 * The station never accepts raw printer bytes: it renders this validated model locally.
 */
sealed class Block {
    data class Text(val text: String, val size: String, val bold: Boolean, val align: String, val dir: String?) : Block()
    data class Row(val start: String, val end: String, val size: String, val bold: Boolean, val endDir: String?) : Block()
    data class Rule(val dashed: Boolean) : Block()
    data class Spacer(val px: Int) : Block()
    data class Box(val title: String?, val lines: List<String>, val size: String, val bold: Boolean) : Block()
}

data class ReceiptModel(
    val locale: String,
    val rtl: Boolean,
    val paperWidthMm: Int,
    val printableDots: Int,
    val simulation: Boolean,
    val blocks: List<Block>,
) {
    companion object {
        fun parse(json: JSONObject): ReceiptModel {
            require(json.optInt("version") == 1) { "unsupported receipt version" }
            val blocks = mutableListOf<Block>()
            val arr = json.getJSONArray("blocks")
            for (i in 0 until arr.length()) {
                val b = arr.getJSONObject(i)
                when (b.getString("kind")) {
                    "text" -> blocks += Block.Text(b.getString("text"), b.optString("size", "md"), b.optBoolean("bold"), b.optString("align", "start"), b.optString("dir", null))
                    "row" -> blocks += Block.Row(b.getString("start"), b.optString("end", ""), b.optString("size", "md"), b.optBoolean("bold"), b.optString("endDir", "ltr"))
                    "rule" -> blocks += Block.Rule(b.optString("style") == "dashed")
                    "spacer" -> blocks += Block.Spacer(b.optInt("px", 8))
                    "box" -> {
                        val lines = b.getJSONArray("lines")
                        blocks += Block.Box(b.optString("title", null), (0 until lines.length()).map { lines.getString(it) }, b.optString("size", "md"), b.optBoolean("bold"))
                    }
                }
            }
            return ReceiptModel(
                locale = json.getString("locale"),
                rtl = json.getString("dir") == "rtl",
                paperWidthMm = json.getInt("paperWidthMm"),
                printableDots = json.getInt("printableDots"),
                simulation = json.optJSONObject("labels")?.optBoolean("simulation") ?: false,
                blocks = blocks,
            )
        }
    }
}
