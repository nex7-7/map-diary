import { describe, expect, it } from "vitest";
import { parseEntry } from "../lib/entries/parse-input";
import { addHrefFor, sharedText } from "../lib/entries/share";

const share = (p: Record<string, string>) => sharedText(new URLSearchParams(p));

describe("shared text", () => {
  it("keeps Google Maps share text as it is", () => {
    const text = "Bastian Bandra\nKurla Complex Rd, Bandra West\nhttps://maps.app.goo.gl/abc123";
    expect(share({ title: "Bastian Bandra", text })).toBe(text);
  });

  it("adds a link that came apart from the text", () => {
    expect(share({ title: "Bombay Canteen", text: "Look at this", url: "https://www.zomato.com/mumbai/the-bombay-canteen-lower-parel" })).toBe(
      "Bombay Canteen\nLook at this\nhttps://www.zomato.com/mumbai/the-bombay-canteen-lower-parel",
    );
  });

  it("does not repeat a link already in the text", () => {
    expect(share({ text: "Bastian https://maps.app.goo.gl/abc", url: "https://maps.app.goo.gl/abc" })).toBe("Bastian https://maps.app.goo.gl/abc");
  });

  it("reads back as the place in the Add sheet", () => {
    const href = addHrefFor(share({ text: "Bastian Bandra\nhttps://maps.app.goo.gl/abc123" }));
    expect(href.startsWith("/add#")).toBe(true);
    const text = new URLSearchParams(href.slice("/add#".length)).get("text") ?? "";
    expect(parseEntry(text)).toMatchObject({ name: "Bastian Bandra", link: "https://maps.app.goo.gl/abc123", shortLink: true });
  });

  it("opens an empty Add sheet when nothing came", () => {
    expect(addHrefFor(share({}))).toBe("/add");
  });
});
