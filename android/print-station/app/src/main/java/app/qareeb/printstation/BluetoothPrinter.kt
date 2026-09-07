package app.qareeb.printstation

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

/**
 * Classic Bluetooth (SPP / RFCOMM) transport for ESC/POS printers.
 * Reference: https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices
 * Pairing happens in Android settings; this app only connects to already-bonded devices the staff
 * member selects, after BLUETOOTH_CONNECT is granted at runtime.
 */
class BluetoothPrinter(private val device: BluetoothDevice) {
    private var socket: BluetoothSocket? = null
    private var out: OutputStream? = null
    val name: String @SuppressLint("MissingPermission") get() = device.name ?: device.address

    class PartialTransmission(val stripsSent: Int, val stripsTotal: Int, cause: Throwable) : IOException("partial", cause)

    @SuppressLint("MissingPermission")
    @Throws(IOException::class)
    fun connect() {
        BluetoothAdapter.getDefaultAdapter()?.cancelDiscovery()
        val s = device.createRfcommSocketToServiceRecord(SPP)
        s.connect()
        socket = s
        out = s.outputStream
    }

    val isConnected: Boolean get() = socket?.isConnected == true

    /**
     * Writes init + strips + tail. Progress is reported per strip; an IOException mid-stream is
     * surfaced as [PartialTransmission] so the server can flag the job for staff review instead of
     * silently retransmitting.
     */
    @Throws(IOException::class)
    fun send(strips: List<ByteArray>, cut: Boolean, feedLines: Int, onProgress: (Int, Int) -> Unit) {
        val o = out ?: throw IOException("not connected")
        var sent = 0
        try {
            o.write(EscPos.init())
            for (s in strips) {
                var off = 0
                while (off < s.size) {
                    val n = minOf(CHUNK, s.size - off)
                    o.write(s, off, n)
                    off += n
                }
                o.flush()
                sent++
                onProgress(sent, strips.size)
            }
            if (feedLines > 0) o.write(EscPos.feed(feedLines))
            if (cut) o.write(EscPos.cut())
            o.flush()
        } catch (e: IOException) {
            if (sent == 0) throw e
            throw PartialTransmission(sent, strips.size, e)
        }
    }

    fun close() {
        try { out?.close() } catch (_: IOException) {}
        try { socket?.close() } catch (_: IOException) {}
        socket = null
        out = null
    }

    companion object {
        val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        private const val CHUNK = 512
    }
}
