package com.snehilsinha.map.proximity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Android forgets every fence on reboot and on an app update, so register them again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        FenceRegistrar.refresh(context) { pending.finish() }
    }
}
