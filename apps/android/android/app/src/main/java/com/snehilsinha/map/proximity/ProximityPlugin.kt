package com.snehilsinha.map.proximity

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * The page's door to nearby alerts (apps/web/lib/android/bridge.ts). The page hands over the
 * Want to places and settings; the plugin stores them and keeps the fences registered.
 */
@CapacitorPlugin(
    name = "Proximity",
    permissions = [
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "background", strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class ProximityPlugin : Plugin() {
    private val store by lazy { ProximityStore(context) }

    @PluginMethod
    fun getStatus(call: PluginCall) = call.resolve(status())

    @PluginMethod
    fun setPlaces(call: PluginCall) {
        store.places = ProximityStore.parsePlaces(call.getArray("places"))
        refreshThenResolve(call)
    }

    @PluginMethod
    fun setSettings(call: PluginCall) {
        store.settings = AlertSettings.fromJson(call.getObject("settings"))
        refreshThenResolve(call)
    }

    @PluginMethod
    fun requestLocation(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) return refreshThenResolve(call)
        requestPermissionForAlias("location", call, "permissionAnswered")
    }

    /** On Android 11 and later this opens the location settings, where "Allow all the time" is. */
    @PluginMethod
    fun requestBackgroundLocation(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("background") == PermissionState.GRANTED) {
            return refreshThenResolve(call)
        }
        requestPermissionForAlias("background", call, "permissionAnswered")
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            return call.resolve(status())
        }
        requestPermissionForAlias("notifications", call, "permissionAnswered")
    }

    @PermissionCallback
    fun permissionAnswered(call: PluginCall) = refreshThenResolve(call)

    /** Asks to leave the app out of battery optimisation (allowed for a sideloaded app). */
    @SuppressLint("BatteryLife")
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        runCatching { activity.startActivity(intent) }
            .recoverCatching { activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        call.resolve()
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
        call.resolve()
    }

    /** The app comes back from a settings screen: permissions may have changed. */
    override fun handleOnResume() {
        super.handleOnResume()
        FenceRegistrar.refresh(context)
    }

    private fun refreshThenResolve(call: PluginCall) {
        FenceRegistrar.refresh(context) { activity.runOnUiThread { call.resolve(status()) } }
    }

    private fun status(): JSObject {
        val location = state("location")
        val background = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) location else state("background")
        val notifications = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) "granted" else state("notifications")
        val power = context.getSystemService(PowerManager::class.java)
        return JSObject()
            .put("location", location)
            .put("background", background)
            .put("notifications", notifications)
            .put("batteryUnrestricted", power?.isIgnoringBatteryOptimizations(context.packageName) == true)
            .put("settings", JSObject.fromJSONObject(store.settings.toJson()))
            .put("placeCount", store.places.size)
            .put("watching", store.watching)
    }

    private fun state(alias: String): String = getPermissionState(alias)?.toString() ?: "prompt"
}
