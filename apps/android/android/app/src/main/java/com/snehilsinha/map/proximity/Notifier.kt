package com.snehilsinha.map.proximity

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.snehilsinha.map.MainActivity
import com.snehilsinha.map.R
import java.util.Calendar

/** Posts the nearby alert, unless it is quiet hours or the place alerted recently. */
object Notifier {
    const val EXTRA_PLACE_ID = "com.snehilsinha.map.PLACE_ID"
    private const val CHANNEL_ID = "nearby"
    private const val DAY_MS = 24L * 60 * 60 * 1000

    @SuppressLint("MissingPermission") // Checked just above the notify call.
    fun maybeNotify(context: Context, store: ProximityStore, place: AlertPlace, now: Long = System.currentTimeMillis()) {
        val settings = store.settings
        if (!settings.enabled) return
        val cal = Calendar.getInstance().apply { timeInMillis = now }
        if (settings.isQuiet(cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE))) return
        if (now - store.lastAlertAt(place.id) < settings.cooldownDays * DAY_MS) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        ensureChannel(context)
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_PLACE_ID, place.id)
        val tap = PendingIntent.getActivity(
            context, place.id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_pin)
            .setContentTitle(place.name.ifBlank { "A Want to place" })
            .setContentText("You're near it. It's on your Want to list.")
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(place.id.hashCode(), notification)
        store.markAlerted(place.id, now)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Nearby places", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "When you linger near a place on your Want to list"
            },
        )
    }
}
