package app.qareeb.printstation

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Foreground service that owns the RFCOMM connection and the claim → render → send → report loop.
 *
 * Guarantees and limits (documented in docs/PRINTING.md):
 * - A job is claimed with a station-bound lease + fence; only this fence may report it.
 * - "failed_before_send" (nothing on the wire) is retryable by the server; a partial transmission is
 *   reported as such and left for staff review — never retransmitted automatically.
 * - The loop stops when the heartbeat is refused (revoked membership/station), on sign-out, or when
 *   the service is destroyed. Printing does not continue after force-stop or without connectivity.
 * - No receipt content is written to disk; the receipt model lives only in memory for the job's life.
 */
class StationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private var printer: BluetoothPrinter? = null
    private lateinit var client: JobClient
    private var stationId: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val printerId = intent?.getStringExtra(EXTRA_PRINTER_ID) ?: return START_NOT_STICKY
        val device = intent.getParcelableExtra<BluetoothDevice>(EXTRA_DEVICE) ?: return START_NOT_STICKY
        val takeOver = intent.getBooleanExtra(EXTRA_TAKE_OVER, false)
        client = JobClient(FirebaseHolder.functions(this))
        startForeground(NOTIF_ID, notification(getString(R.string.status_idle)))
        loop?.cancel()
        loop = scope.launch { run(printerId, device, takeOver) }
        return START_NOT_STICKY
    }

    private suspend fun run(printerId: String, device: BluetoothDevice, takeOver: Boolean) {
        val renderer = ReceiptRenderer(this)
        try {
            val p = BluetoothPrinter(device)
            p.connect()
            printer = p
            stationId = client.registerStation(printerId, "${Build.MODEL} · ${p.name}", takeOver, stationId)
            status.value = getString(R.string.status_connected, p.name)
            var lastHeartbeat = 0L
            while (true) {
                val now = System.currentTimeMillis()
                if (now - lastHeartbeat > 45_000) {
                    try { client.heartbeat(stationId!!) } catch (e: JobClient.ApiError) {
                        if (e.code == "forbidden" || e.code == "not_found") { status.value = getString(R.string.status_revoked); stopSelf(); return }
                    }
                    lastHeartbeat = now
                }
                val claim = try { client.claim(stationId!!) } catch (e: Exception) { status.value = getString(R.string.status_offline); null }
                if (claim != null) {
                    if (!p.isConnected) {
                        client.report(stationId!!, claim.jobId, claim.fence, claim.attemptId, "failed_before_send", "printer_not_connected")
                        status.value = getString(R.string.status_disconnected)
                    } else {
                        status.value = getString(R.string.status_printing)
                        try {
                            val model = ReceiptModel.parse(claim.receipt)
                            val bmp = withContext(Dispatchers.Default) { renderer.render(model) }
                            val strips = EscPos.strips(bmp, claim.maxStripRows)
                            p.send(strips, claim.cut, claim.feedLines) { sent, total -> progress.value = sent to total }
                            client.report(stationId!!, claim.jobId, claim.fence, claim.attemptId, "sent", null, strips.size, strips.size)
                            status.value = getString(R.string.status_connected, p.name)
                        } catch (e: BluetoothPrinter.PartialTransmission) {
                            client.report(stationId!!, claim.jobId, claim.fence, claim.attemptId, "partial", "rfcomm_write_failed", e.stripsSent, e.stripsTotal)
                            status.value = getString(R.string.status_disconnected)
                        } catch (e: IOException) {
                            client.report(stationId!!, claim.jobId, claim.fence, claim.attemptId, "failed_before_send", e.message)
                            status.value = getString(R.string.status_disconnected)
                        } catch (e: IllegalArgumentException) {
                            client.report(stationId!!, claim.jobId, claim.fence, claim.attemptId, "failed_before_send", "invalid_receipt_model")
                        }
                    }
                }
                updateNotification(status.value)
                delay(if (claim != null) 500 else 4_000)
            }
        } catch (e: IOException) {
            status.value = getString(R.string.status_disconnected)
        } catch (e: JobClient.ApiError) {
            status.value = if (e.code == "invalid_argument") getString(R.string.another_station) else e.code
        }
    }

    override fun onDestroy() {
        loop?.cancel()
        stationId?.let { id -> scope.launch { runCatching { client.release(id) } } }
        printer?.close()
        printer = null
        status.value = getString(R.string.status_idle)
        super.onDestroy()
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_share).setContentTitle(getString(R.string.app_name)).setContentText(text).setOngoing(true).build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(text))
    }

    companion object {
        const val EXTRA_PRINTER_ID = "printerId"
        const val EXTRA_DEVICE = "device"
        const val EXTRA_TAKE_OVER = "takeOver"
        private const val CHANNEL = "station"
        private const val NOTIF_ID = 1
        val status = MutableStateFlow("")
        val progress = MutableStateFlow(0 to 0)
        @Suppress("unused") val serviceType = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
    }
}
