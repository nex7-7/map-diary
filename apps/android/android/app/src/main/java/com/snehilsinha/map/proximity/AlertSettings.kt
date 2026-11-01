package com.snehilsinha.map.proximity

import org.json.JSONObject

/** When an alert goes off. Mirrors `AlertSettings` in apps/web/lib/android/proximity.ts. */
data class AlertSettings(
    val enabled: Boolean = true,
    val radiusM: Int = 200,
    val dwellSeconds: Int = 60,
    val cooldownDays: Int = 3,
    /** Minutes after local midnight; equal start and end means no quiet hours. */
    val quietStartMin: Int = 23 * 60,
    val quietEndMin: Int = 8 * 60,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("enabled", enabled)
        .put("radiusM", radiusM)
        .put("dwellSeconds", dwellSeconds)
        .put("cooldownDays", cooldownDays)
        .put("quietStartMin", quietStartMin)
        .put("quietEndMin", quietEndMin)

    /** True when [minuteOfDay] falls in the quiet hours, which may run past midnight. */
    fun isQuiet(minuteOfDay: Int): Boolean = when {
        quietStartMin == quietEndMin -> false
        quietStartMin < quietEndMin -> minuteOfDay in quietStartMin until quietEndMin
        else -> minuteOfDay >= quietStartMin || minuteOfDay < quietEndMin
    }

    companion object {
        /** Reads settings from the page or from storage, keeping every value in range. */
        fun fromJson(o: JSONObject?): AlertSettings {
            val d = AlertSettings()
            if (o == null) return d
            fun int(key: String, def: Int, lo: Int, hi: Int) = o.optInt(key, def).coerceIn(lo, hi)
            return AlertSettings(
                enabled = o.optBoolean("enabled", d.enabled),
                radiusM = int("radiusM", d.radiusM, 100, 1000),
                dwellSeconds = int("dwellSeconds", d.dwellSeconds, 0, 600),
                cooldownDays = int("cooldownDays", d.cooldownDays, 1, 30),
                quietStartMin = int("quietStartMin", d.quietStartMin, 0, 1439),
                quietEndMin = int("quietEndMin", d.quietEndMin, 0, 1439),
            )
        }
    }
}
