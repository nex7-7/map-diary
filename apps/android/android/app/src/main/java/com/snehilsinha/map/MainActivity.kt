package com.snehilsinha.map

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity
import com.snehilsinha.map.proximity.Notifier
import com.snehilsinha.map.proximity.ProximityPlugin

/** The live site in a WebView, plus the share sheet and taps on nearby alerts. */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ProximityPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Back goes back a page, as in the browser, and leaves the app from the first one.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val web = bridge?.webView
                if (web != null && web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    // Also runs once at start with the launching intent (BridgeActivity.load).
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val path = pathFor(intent) ?: return
        val b = bridge ?: return
        val base = b.serverUrl ?: return
        b.webView.loadUrl(base.trimEnd('/') + path)
    }

    /**
     * Shared text goes to `/share`, which moves it into the Add sheet; an alert opens its place.
     * The place id rides in the fragment, which the WebView never sends to the server.
     */
    private fun pathFor(intent: Intent): String? {
        if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("text/") == true) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
            val title = intent.getStringExtra(Intent.EXTRA_SUBJECT)
            val query = buildString {
                append("text=").append(Uri.encode(text))
                if (!title.isNullOrBlank()) append("&title=").append(Uri.encode(title))
            }
            intent.action = null // Handled; a rotation or relaunch must not add it twice.
            return "/share?$query"
        }
        val placeId = intent.getStringExtra(Notifier.EXTRA_PLACE_ID) ?: return null
        intent.removeExtra(Notifier.EXTRA_PLACE_ID)
        return "/place#" + Uri.encode(placeId)
    }
}
