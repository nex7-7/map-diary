package com.snehilsinha.map.proximity

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

/**
 * Keeps the rolling set of fences: the nearest [MAX_PLACES] Want to places, plus one
 * [REFRESH_RADIUS_M] fence around where the phone is, whose exit registers the next set.
 * Android allows 100 fences per app. Everything runs on the phone.
 */
object FenceRegistrar {
    const val MAX_PLACES = 99
    const val REFRESH_ID = "refresh"
    const val PLACE_PREFIX = "p:"
    private const val REFRESH_RADIUS_M = 2000f
    private const val TAG = "Proximity"

    fun hasPermissions(context: Context): Boolean {
        fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
        val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        return granted(Manifest.permission.ACCESS_FINE_LOCATION) && background
    }

    /**
     * Re-registers every fence around [here], or around the phone's current location when it is
     * null. Calls [done] with the number of place fences registered (0 when off or not allowed).
     */
    @SuppressLint("MissingPermission") // Checked by hasPermissions.
    fun refresh(context: Context, here: Location? = null, done: (Int) -> Unit = {}) {
        val app = context.applicationContext
        val store = ProximityStore(app)
        val client = LocationServices.getGeofencingClient(app)
        val settings = store.settings
        val places = store.places
        if (!settings.enabled || places.isEmpty() || !hasPermissions(app)) {
            client.removeGeofences(pendingIntent(app)).addOnCompleteListener {
                store.watching = 0
                done(0)
            }
            return
        }
        if (here != null) return register(app, store, here, done)
        val fused = LocationServices.getFusedLocationProviderClient(app)
        fused.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, CancellationTokenSource().token)
            .addOnSuccessListener { current ->
                if (current != null) register(app, store, current, done)
                else fused.lastLocation.addOnCompleteListener { register(app, store, if (it.isSuccessful) it.result else null, done) }
            }
            .addOnFailureListener { register(app, store, null, done) }
    }

    @SuppressLint("MissingPermission")
    private fun register(app: Context, store: ProximityStore, here: Location?, done: (Int) -> Unit) {
        val settings = store.settings
        val places = store.places
        // With no fix yet, watch any 99 and no refresh fence; the next app start fixes the set.
        val nearest = if (here == null) places.take(MAX_PLACES) else places.sortedBy { distance(here, it) }.take(MAX_PLACES)
        val fences = nearest.map {
            Geofence.Builder()
                .setRequestId(PLACE_PREFIX + it.id)
                .setCircularRegion(it.lat, it.lng, settings.radiusM.toFloat())
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
                .setLoiteringDelay(settings.dwellSeconds * 1000)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .build()
        }.toMutableList()
        if (here != null && places.size > MAX_PLACES) {
            fences.add(
                Geofence.Builder()
                    .setRequestId(REFRESH_ID)
                    .setCircularRegion(here.latitude, here.longitude, REFRESH_RADIUS_M)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .build(),
            )
        }
        val request = GeofencingRequest.Builder()
            // Standing at a place when the set is registered still alerts after the dwell time;
            // the per-place cooldown keeps re-registrations from repeating it.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofences(fences)
            .build()
        val client = LocationServices.getGeofencingClient(app)
        val intent = pendingIntent(app)
        client.removeGeofences(intent).addOnCompleteListener {
            client.addGeofences(request, intent)
                .addOnSuccessListener {
                    store.watching = nearest.size
                    done(nearest.size)
                }
                .addOnFailureListener { e ->
                    // Only the error, never a place or a position.
                    Log.w(TAG, "Could not register fences: ${e.javaClass.simpleName}")
                    store.watching = 0
                    done(0)
                }
        }
    }

    private fun distance(here: Location, place: AlertPlace): Float {
        val out = FloatArray(1)
        Location.distanceBetween(here.latitude, here.longitude, place.lat, place.lng, out)
        return out[0]
    }

    private fun pendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, GeofenceReceiver::class.java)
        // Mutable: Play services adds the event to it.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }
}
