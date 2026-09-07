package app.qareeb.printstation

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.ArrayAdapter
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import app.qareeb.printstation.databinding.ActivityMainBinding
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Single-screen print station: email sign-in → membership-verified branch/printer selection →
 * bonded printer selection → start/stop foreground station → test print. Not a marketplace app.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private data class PrinterRow(val id: String, val branchId: String, val businessId: String, val name: String)
    private var printers: List<PrinterRow> = emptyList()
    private var bonded: List<BluetoothDevice> = emptyList()

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.all { it }) loadBonded() else b.status.text = getString(R.string.permission_needed)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        auth = FirebaseHolder.auth(this)
        db = FirebaseHolder.firestore(this)
        b.signIn.setOnClickListener { signIn() }
        b.signOut.setOnClickListener { stopStation(); auth.signOut(); purgeLocalState(); render() }
        b.start.setOnClickListener { startStation(false) }
        b.stop.setOnClickListener { stopStation() }
        b.testPrint.setOnClickListener { lifecycleScope.launch { runCatching { JobClient(FirebaseHolder.functions(this@MainActivity)).enqueueTest(selectedPrinter()?.id ?: return@launch) } } }
        lifecycleScope.launch { StationService.status.collect { b.status.text = it.ifEmpty { getString(R.string.status_idle) } } }
        render()
    }

    private fun render() {
        val user = auth.currentUser
        b.authGroup.visibility = if (user == null) android.view.View.VISIBLE else android.view.View.GONE
        b.stationGroup.visibility = if (user == null) android.view.View.GONE else android.view.View.VISIBLE
        if (user != null) { loadPrinters(); requestBluetoothPermissions() }
    }

    private fun signIn() {
        val email = b.email.text.toString().trim()
        val password = b.password.text.toString()
        lifecycleScope.launch {
            try {
                auth.signInWithEmailAndPassword(email, password).await()
                JobClient(FirebaseHolder.functions(this@MainActivity)).ensureProfile()
                render()
            } catch (e: Exception) { b.status.text = e.localizedMessage }
        }
    }

    /** Lists printers of branches the current membership covers (server rules enforce the same). */
    private fun loadPrinters() {
        val uid = auth.currentUser?.uid ?: return
        lifecycleScope.launch {
            try {
                val memberships = db.collection("memberships").whereEqualTo("uid", uid).whereEqualTo("active", true).get().await()
                val rows = mutableListOf<PrinterRow>()
                for (m in memberships.documents) {
                    val businessId = m.getString("businessId") ?: continue
                    val all = m.getBoolean("allBranches") ?: false
                    val branchIds = (m.get("branchIds") as? List<*>)?.map { it.toString() } ?: emptyList()
                    val ps = db.collection("printers").whereEqualTo("businessId", businessId).whereEqualTo("active", true).whereEqualTo("transport", "android_rfcomm").get().await()
                    for (p in ps.documents) {
                        val branchId = p.getString("branchId") ?: continue
                        if (all || branchIds.contains(branchId)) rows += PrinterRow(p.id, branchId, businessId, "${p.getString("name")} · $branchId")
                    }
                }
                printers = rows
                b.printerSpinner.adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, rows.map { it.name })
                if (rows.isEmpty()) b.status.text = getString(R.string.no_membership)
            } catch (e: Exception) { b.status.text = e.localizedMessage }
        }
    }

    private fun requestBluetoothPermissions() {
        val needed = if (Build.VERSION.SDK_INT >= 31) listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN) else emptyList()
        val missing = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) loadBonded() else permissionLauncher.launch(missing.toTypedArray())
    }

    @Suppress("MissingPermission")
    private fun loadBonded() {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) { b.status.text = getString(R.string.bluetooth_off); return }
        bonded = adapter.bondedDevices.toList()
        b.deviceSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, bonded.map { it.name ?: it.address })
    }

    private fun selectedPrinter(): PrinterRow? = printers.getOrNull(b.printerSpinner.selectedItemPosition)

    private fun startStation(takeOver: Boolean) {
        val printer = selectedPrinter() ?: return
        val device = bonded.getOrNull(b.deviceSpinner.selectedItemPosition) ?: return
        val intent = Intent(this, StationService::class.java).putExtra(StationService.EXTRA_PRINTER_ID, printer.id).putExtra(StationService.EXTRA_DEVICE, device).putExtra(StationService.EXTRA_TAKE_OVER, takeOver)
        ContextCompat.startForegroundService(this, intent)
    }

    private fun stopStation() { stopService(Intent(this, StationService::class.java)) }

    /** Purge any device-local state on sign-out (no receipt data is persisted, but clear prefs too). */
    private fun purgeLocalState() { getSharedPreferences("station", MODE_PRIVATE).edit().clear().apply() }
}
