package lk.blynk.customer

import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity: FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 12+ removes its splash with a ~300 ms fade by default. The
        // Flutter intro (BlynkLaunchScreen) draws the very same logo at the
        // very same size underneath, so that fade read as the logo vanishing
        // and a second intro appearing (2026-09-26, seen on a recording).
        // Removing the system splash instantly makes the handover invisible:
        // one logo, one intro.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            splashScreen.setOnExitAnimationListener { view -> view.remove() }
        }
    }
}
