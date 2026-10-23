"use client";

import { Button, ButtonLink } from "@/lib/ui";
import { userMessage } from "@/lib/errors";

/**
 * When a screen breaks while drawing, this page stands in for it instead of a blank one. The
 * person's items and keys are untouched; trying again redraws the screen.
 */
export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-12">
      <p className="hand text-[19px] text-seal-deep">Oops, a page tore.</p>
      <h1 className="m-0 font-serif text-[32px] leading-tight font-bold">This screen couldn&apos;t open.</h1>
      <p className="m-0 text-ink-2">{userMessage(error)} Your places and keys on this device are safe.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={retry}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Back to the diary
        </ButtonLink>
      </div>
    </main>
  );
}
