package com.snehilsinha.map.proximity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/** Play services calls this when the phone lingers at a place or leaves the refresh fence. */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.w("Proximity", "Geofence error ${GeofenceStatusCodes.getStatusCodeString(event.errorCode)}")
            return
        }
        val ids = event.triggeringGeofences?.map { it.requestId }.orEmpty()
        when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_DWELL -> {
                val store = ProximityStore(context)
                val byId = store.places.associateBy { FenceRegistrar.PLACE_PREFIX + it.id }
                ids.mapNotNull { byId[it] }.forEach { Notifier.maybeNotify(context, store, it) }
            }
            Geofence.GEOFENCE_TRANSITION_EXIT -> if (FenceRegistrar.REFRESH_ID in ids) {
                val pending = goAsync()
                FenceRegistrar.refresh(context, event.triggeringLocation) { pending.finish() }
            }
        }
    }
}
