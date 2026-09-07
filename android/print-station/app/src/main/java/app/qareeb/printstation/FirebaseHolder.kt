package app.qareeb.printstation

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions

/** Firebase singletons with optional Emulator Suite wiring (BuildConfig.EMULATOR_HOST). */
object FirebaseHolder {
    private var wired = false
    private fun wire(context: Context) {
        if (wired) return
        FirebaseApp.initializeApp(context)
        val host = BuildConfig.EMULATOR_HOST
        if (host.isNotEmpty()) {
            FirebaseAuth.getInstance().useEmulator(host, 9099)
            FirebaseFunctions.getInstance(BuildConfig.FUNCTIONS_REGION).useEmulator(host, 5001)
            FirebaseFirestore.getInstance().useEmulator(host, 8080)
        }
        wired = true
    }
    fun auth(context: Context): FirebaseAuth { wire(context); return FirebaseAuth.getInstance() }
    fun functions(context: Context): FirebaseFunctions { wire(context); return FirebaseFunctions.getInstance(BuildConfig.FUNCTIONS_REGION) }
    fun firestore(context: Context): FirebaseFirestore { wire(context); return FirebaseFirestore.getInstance() }
}
