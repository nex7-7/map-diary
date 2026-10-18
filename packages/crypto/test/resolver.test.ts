import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateReplyKeys,
  openResolverResult,
  parseResolution,
  ready,
  sealResolverResult,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

const britannia = {
  name: "  Britannia & Co. ",
  category: "restaurant",
  location: { lat: 18.9345671234, lng: 72.8399 },
  address: "Wakefield House, Ballard Estate, Fort",
  cuisine: "Parsi",
  signatureDish: { name: "Berry pulao", priceInr: 750 },
  sourceLinks: ["https://www.zomato.com/mumbai/britannia-co-fort", "https://www.zomato.com/mumbai/britannia-co-fort"],
};

describe("parseResolution", () => {
  it("accepts a food place with a signature dish and tidies it", () => {
    const parsed = parseResolution({ candidates: [britannia] });
    expect(parsed).toEqual({
      ok: true,
      result: {
        v: 1,
        candidates: [
          {
            name: "Britannia & Co.",
            category: "restaurant",
            location: { lat: 18.934567, lng: 72.8399 },
            address: "Wakefield House, Ballard Estate, Fort",
            cuisine: "Parsi",
            signatureDish: { name: "Berry pulao", priceInr: 750 },
            sourceLinks: ["https://www.zomato.com/mumbai/britannia-co-fort"],
          },
        ],
      },
    });
  });

  it("accepts several candidates without optional fields", () => {
    const juhu = { name: "Juhu Beach", category: "beach", location: { lat: 19.0988, lng: 72.8267 } };
    const parsed = parseResolution({ candidates: [juhu, { ...juhu, name: "Juhu Beach (north)" }] });
    expect(parsed.ok && parsed.result.candidates.map((c) => c.sourceLinks)).toEqual([[], []]);
  });

  it.each([
    [{}, "bad_shape"],
    [{ candidates: [] }, "no_candidates"],
    [{ candidates: Array(6).fill(britannia) }, "too_many_candidates"],
    [{ candidates: [{ ...britannia, name: " " }] }, "bad_name"],
    [{ candidates: [{ ...britannia, category: "custom:rooftops" }] }, "bad_category"],
    [{ candidates: [{ ...britannia, location: { lat: 28.61, lng: 77.2 } }] }, "outside_mumbai"],
    [{ candidates: [{ ...britannia, location: { lat: "18.9", lng: 72.8 } }] }, "outside_mumbai"],
    [{ candidates: [{ ...britannia, signatureDish: { name: "Pulao", priceInr: 0 } }] }, "bad_price"],
    [{ candidates: [{ ...britannia, signatureDish: { name: "Pulao", priceInr: 99.5 } }] }, "bad_price"],
    [{ candidates: [{ ...britannia, signatureDish: { name: "Pulao", priceInr: 900_000 } }] }, "bad_price"],
    [{ candidates: [{ ...britannia, category: "beach" }] }, "dish_not_food"],
    [{ candidates: [{ ...britannia, sourceLinks: ["javascript:alert(1)"] }] }, "bad_link"],
    [{ candidates: [{ ...britannia, sourceLinks: ["http://example.com"] }] }, "bad_link"],
  ])("rejects %j as %s", (value, problem) => {
    expect(parseResolution(value)).toEqual({ ok: false, problem });
  });
});

describe("sealed results", () => {
  it("opens only with the job's one-time key", () => {
    const keys = generateReplyKeys();
    const other = generateReplyKeys();
    const parsed = parseResolution({ candidates: [britannia] });
    if (!parsed.ok) throw new Error("fixture should parse");

    const sealed = sealResolverResult(parsed.result, keys.publicKey);
    expect(openResolverResult(sealed, keys)).toEqual(parsed.result);
    expect(() => openResolverResult(sealed, other)).toThrow(CryptoError);
  });

  it("re-checks what it opens", () => {
    const keys = generateReplyKeys();
    const bad = { v: 1, candidates: [{ ...britannia, location: { lat: 0, lng: 0 } }] };
    const sealed = sealResolverResult(bad as never, keys.publicKey);
    expect(() => openResolverResult(sealed, keys)).toThrow(/checks/);
  });

  it("rejects a short public key", () => {
    expect(() => sealResolverResult({ v: 1, candidates: [] }, new Uint8Array(8))).toThrow(CryptoError);
  });
});
