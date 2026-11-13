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
    /**
     * Set when Android rebuilds the app after closing it in the background (Nothing OS does this
     * often) and the person comes back from Recents. Android then hands back the intent that first
     * opened the app, so an old share or alert would open again; instead the page they were on
     * comes back.
     */
    private var returning = false
    private var returnTo: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ProximityPlugin::class.java)
        // Read before super.onCreate, which loads the site and runs onNewIntent once.
        returning = savedInstanceState != null ||
            (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        returnTo = savedInstanceState?.getString(KEY_PAGE)
        super.onCreate(savedInstanceState)
        // Back goes back a page, as in the browser, and leaves the app from the first one.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val web = bridge?.webView
                if (web != null && web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    /** Remembers the page on screen, so a rebuilt app reopens it. It stays on the phone. */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val page = bridge?.webView?.url ?: return
        if (ownPage(page) && !page.contains("/share")) outState.putString(KEY_PAGE, page)
    }

    // Also runs once at start with the launching intent (BridgeActivity.load).
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val b = bridge ?: return
        val base = b.serverUrl ?: return
        if (returning) {
            // Only the start-up call can be a return; a share that arrives later is new.
            returning = false
            val page = returnTo?.takeIf(::ownPage)
            returnTo = null
            if (page != null) b.webView.loadUrl(page)
            return
        }
        val path = pathFor(intent) ?: return
        b.webView.loadUrl(base.trimEnd('/') + path)
    }

    private fun ownPage(url: String): Boolean {
        val base = bridge?.serverUrl?.trimEnd('/') ?: return false
        return url == base || url.startsWith("$base/") || url.startsWith("$base#")
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

    private companion object {
        const val KEY_PAGE = "page"
    }
}
