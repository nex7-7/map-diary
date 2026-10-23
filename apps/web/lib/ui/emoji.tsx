/**
 * Emoji we draw ourselves because the system font gets them wrong for Mumbai. Android's 🛺 is
 * green and yellow; Mumbai autos are black below and yellow on top.
 */
const DRAWN: Record<string, string> = {
  "🛺":
    // Side view, facing left: yellow hood with a rounded back, open side, black body.
    '<path fill="#f5c400" stroke="#1b1b1b" stroke-width="1.2" stroke-linejoin="round" d="M10 18.5 11 8.5Q11.5 6 14.5 6H22Q29.5 6 29.5 14V19H26V11.5H15.5V18.5Z"/>' +
    '<path fill="#1b1b1b" d="M3 24.5Q2.5 20.5 6 18.5L9.5 17 11 8.5H12.6L11.4 17.5H29.5V24.5Z"/>' +
    '<path fill="#bcd9e3" d="M11.6 9.5 10.6 16.6 7.4 18Q8.6 12 11.6 9.5Z"/>' +
    '<path fill="#f5c400" d="M14 20H28V21.5H14Z"/>' +
    '<circle cx="4" cy="21.8" r="1" fill="#fff4b0"/>' +
    '<circle cx="7.5" cy="25.5" r="3" fill="#2a2a2a" stroke="#1b1b1b"/><circle cx="7.5" cy="25.5" r="1.1" fill="#c9c9c9"/>' +
    '<circle cx="24.5" cy="25.5" r="3.2" fill="#2a2a2a" stroke="#1b1b1b"/><circle cx="24.5" cy="25.5" r="1.2" fill="#c9c9c9"/>',
};

/** An emoji as text, or our own drawing of it when the system one looks wrong. Sized to 1em. */
export function Emoji({ emoji }: { emoji: string }) {
  const drawn = DRAWN[emoji.replace(/\uFE0F/g, "")];
  if (!drawn) return <>{emoji}</>;
  return (
    <svg
      className="inline-block size-[1.15em] flex-none align-[-0.15em]"
      viewBox="0 0 32 32"
      role="img"
      aria-label={emoji}
      // Static markup from DRAWN above, never user data.
      dangerouslySetInnerHTML={{ __html: drawn }}
    />
  );
}
