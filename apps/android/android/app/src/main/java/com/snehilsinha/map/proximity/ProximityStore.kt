package com.snehilsinha.map.proximity

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One Want to place: only its id, name and pin are ever kept on the phone. */
data class AlertPlace(val id: String, val name: String, val lat: Double, val lng: Double)

/**
 * App-private storage for nearby alerts, so they work while the app is closed: the Want to
 * places, the settings, when each place last alerted, and how many fences are registered.
 * Android excludes it from backups (allowBackup is off), so it never leaves the phone.
 */
class ProximityStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("proximity", Context.MODE_PRIVATE)

    var places: List<AlertPlace>
        get() = parsePlaces(JSONArray(prefs.getString(KEY_PLACES, "[]")))
        set(value) {
            val array = JSONArray()
            value.forEach { array.put(JSONObject().put("id", it.id).put("name", it.name).put("lat", it.lat).put("lng", it.lng)) }
            prefs.edit().putString(KEY_PLACES, array.toString()).apply()
        }

    var settings: AlertSettings
        get() = AlertSettings.fromJson(prefs.getString(KEY_SETTINGS, null)?.let { JSONObject(it) })
        set(value) = prefs.edit().putString(KEY_SETTINGS, value.toJson().toString()).apply()

    /** How many place fences are registered right now (the refresh fence not counted). */
    var watching: Int
        get() = prefs.getInt(KEY_WATCHING, 0)
        set(value) = prefs.edit().putInt(KEY_WATCHING, value).apply()

    fun lastAlertAt(placeId: String): Long = prefs.getLong(KEY_ALERTED + placeId, 0L)

    fun markAlerted(placeId: String, at: Long) = prefs.edit().putLong(KEY_ALERTED + placeId, at).apply()

    companion object {
        private const val KEY_PLACES = "places"
        private const val KEY_SETTINGS = "settings"
        private const val KEY_WATCHING = "watching"
        private const val KEY_ALERTED = "alerted:"

        /** Places from the page, dropping any entry that is not a whole id, name and pin. */
        fun parsePlaces(array: JSONArray?): List<AlertPlace> {
            if (array == null) return emptyList()
            val out = ArrayList<AlertPlace>(array.length())
            for (i in 0 until array.length()) {
                val o = array.optJSONObject(i) ?: continue
                val id = o.optString("id")
                val lat = o.optDouble("lat")
                val lng = o.optDouble("lng")
                if (id.isEmpty() || lat.isNaN() || lng.isNaN() || lat !in -90.0..90.0 || lng !in -180.0..180.0) continue
                out.add(AlertPlace(id, o.optString("name").take(120), lat, lng))
            }
            return out
        }
    }
}
