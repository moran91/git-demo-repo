package app.qareeb.printstation

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/** Thin wrapper over the same authenticated callables the web dashboard uses. */
class JobClient(private val functions: FirebaseFunctions) {
    class ApiError(val code: String) : Exception(code)

    private suspend fun call(name: String, data: Map<String, Any?>): Map<String, Any?> {
        try {
            @Suppress("UNCHECKED_CAST")
            return (functions.getHttpsCallable(name).call(data).await().data as? Map<String, Any?>) ?: emptyMap()
        } catch (e: FirebaseFunctionsException) {
            @Suppress("UNCHECKED_CAST")
            val details = e.details as? Map<String, Any?>
            throw ApiError((details?.get("code") as? String) ?: e.code.name.lowercase())
        }
    }

    suspend fun ensureProfile() = call("ensureProfile", emptyMap())

    suspend fun registerStation(printerId: String, label: String, takeOver: Boolean, stationId: String?): String {
        val r = call("registerStation", mapOf("printerId" to printerId, "kind" to "android", "label" to label, "takeOver" to takeOver, "stationId" to stationId, "appVersion" to BuildConfig.VERSION_NAME))
        @Suppress("UNCHECKED_CAST")
        return (r["station"] as Map<String, Any?>)["id"] as String
    }

    suspend fun heartbeat(stationId: String) = call("stationHeartbeat", mapOf("stationId" to stationId))
    suspend fun release(stationId: String) = call("releaseStation", mapOf("stationId" to stationId))

    data class Claim(val jobId: String, val fence: Int, val attemptId: String, val receipt: JSONObject, val cut: Boolean, val feedLines: Int, val maxStripRows: Int)

    suspend fun claim(stationId: String, jobId: String? = null): Claim? {
        val r = call("claimPrintJob", mapOf("stationId" to stationId, "jobId" to jobId, "includeStale" to (jobId != null)))
        @Suppress("UNCHECKED_CAST")
        val job = r["job"] as? Map<String, Any?> ?: return null
        @Suppress("UNCHECKED_CAST")
        val printer = r["printer"] as Map<String, Any?>
        return Claim(
            jobId = job["id"] as String,
            fence = (r["fence"] as Number).toInt(),
            attemptId = r["attemptId"] as String,
            receipt = JSONObject(job["receipt"] as Map<*, *>),
            cut = printer["cutSupported"] as? Boolean ?: false,
            feedLines = (printer["feedLinesAfter"] as? Number)?.toInt() ?: 3,
            maxStripRows = 256,
        )
    }

    suspend fun report(stationId: String, jobId: String, fence: Int, attemptId: String, outcome: String, error: String? = null, stripsSent: Int? = null, stripsTotal: Int? = null) =
        call("reportPrintAttempt", mapOf("stationId" to stationId, "jobId" to jobId, "fence" to fence, "attemptId" to attemptId, "outcome" to outcome, "error" to error, "stripsSent" to stripsSent, "stripsTotal" to stripsTotal))

    suspend fun enqueueTest(printerId: String) = call("enqueuePrint", mapOf("printerId" to printerId, "template" to "test", "idempotencyKey" to java.util.UUID.randomUUID().toString()))

    val uid: String? get() = FirebaseAuth.getInstance().currentUser?.uid
}
