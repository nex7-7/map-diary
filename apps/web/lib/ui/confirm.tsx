"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { CloseButton, Sheet } from "./overlays";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * The app's own yes/no question, in place of the browser's `confirm()`, which looks broken in an
 * installed iPhone app and blocks the page. Render the returned element once; `ask` resolves
 * true when the person confirms, false when they cancel or close the sheet.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolve = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((next: ConfirmOptions) => {
    resolve.current?.(false);
    setOptions(next);
    return new Promise<boolean>((r) => {
      resolve.current = r;
    });
  }, []);

  const answer = (ok: boolean) => {
    resolve.current?.(ok);
    resolve.current = null;
    setOptions(null);
  };

  const element = (
    <Sheet open={options !== null} onClose={() => answer(false)} label={options?.title ?? "Confirm"}>
      {options && (
        <>
          <div className="flex justify-end">
            <CloseButton onClick={() => answer(false)} />
          </div>
          <h2 className="heading-m">{options.title}</h2>
          {options.body && <p style={{ margin: 0, color: "var(--ink-2)" }}>{options.body}</p>}
          <Button variant={options.danger ? "danger" : "primary"} block onClick={() => answer(true)}>
            {options.confirmLabel}
          </Button>
          <Button variant="ghost" block onClick={() => answer(false)}>
            {options.cancelLabel ?? "Cancel"}
          </Button>
        </>
      )}
    </Sheet>
  );

  return [ask, element];
}
