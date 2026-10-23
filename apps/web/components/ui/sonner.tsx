"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Icon } from "@/lib/ui/icon";

/*
 * Toasts in ink and paper: a slip of paper with an ink outline on a hard ink shadow, like the
 * buttons; an error is inked in seal red. Pinned to the top so the phone's nav strip and the
 * Add sheet never cover them, below the notch when installed to the Home Screen. Styles are in
 * app/toast.css.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      offset={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 10px)", left: "12px", right: "12px" }}
      gap={10}
      visibleToasts={3}
      closeButton
      containerAriaLabel="Messages"
      icons={{
        error: <Icon name="alert" size="m" />,
        success: <Icon name="check" size="m" />,
        info: <Icon name="wifiOff" size="m" />,
        warning: <Icon name="alert" size="m" />,
        close: <Icon name="x" size="s" />,
      }}
      className="ink-toaster"
      {...props}
    />
  );
}
