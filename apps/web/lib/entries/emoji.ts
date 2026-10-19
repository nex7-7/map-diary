const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * The last emoji in some typed text, or "" when there is none: a tag's emoji is one emoji, so
 * letters are dropped and a newly typed emoji replaces the old one.
 */
export function oneEmoji(text: string): string {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((g) => g.segment);
  return graphemes.reverse().find((g) => PICTURE.test(g)) ?? "";
}
