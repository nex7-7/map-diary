import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateReplyKeys,
  openResolverResult,
  parseOutsidePlace,
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

describe("new food categories", () => {
  it("lets roadside stalls and desserts carry a signature dish", () => {
    for (const category of ["roadside-stall", "desserts"]) {
      expect(parseResolution({ candidates: [{ ...britannia, category }] })).toMatchObject({ ok: true });
    }
  });
});

describe("parseOutsidePlace", () => {
  const amritsar = { name: "ITC Welcomhotel Amritsar", category: "restaurant", location: { lat: 31.6447, lng: 74.8189 } };

  it("accepts a place outside Mumbai, checked like a candidate", () => {
    expect(parseOutsidePlace(amritsar)).toEqual({ ...amritsar, sourceLinks: [] });
    expect(parseOutsidePlace({ ...amritsar, category: "zoo" })).toBe("bad_category");
  });

  it("refuses a place inside Mumbai or off the globe", () => {
    expect(parseOutsidePlace(britannia)).toBe("inside_mumbai");
    expect(parseOutsidePlace({ ...amritsar, location: { lat: 95, lng: 74 } })).toBe("bad_shape");
  });
});

describe("chains", () => {
  const outlet = (lat: number, address: string) => ({ ...britannia, name: "The Bombay Cartel", location: { lat, lng: 72.83 }, address });

  it("keeps a chain's other outlets, checked like candidates", () => {
    const parsed = parseResolution({ candidates: [britannia], chain: { name: " The Bombay Cartel ", outlets: [outlet(19.1, "Bandra"), outlet(19.2, "Andheri")] } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.chain?.name).toBe("The Bombay Cartel");
    expect(parsed.result.chain?.outlets.map((o) => o.address)).toEqual(["Bandra", "Andheri"]);
  });

  it("drops a chain with no other outlets", () => {
    const parsed = parseResolution({ candidates: [britannia], chain: { name: "Solo", outlets: [] } });
    expect(parsed.ok && parsed.result.chain).toBe(undefined);
  });

  it("refuses a bad chain, an outlet outside Mumbai and too many outlets", () => {
    expect(parseResolution({ candidates: [britannia], chain: { outlets: [outlet(19.1, "Bandra")] } })).toEqual({ ok: false, problem: "bad_chain" });
    expect(parseResolution({ candidates: [britannia], chain: { name: "X", outlets: [outlet(28.6, "Delhi")] } })).toEqual({ ok: false, problem: "outside_mumbai" });
    const many = Array.from({ length: 41 }, (_, n) => outlet(19 + n / 1000, `Outlet ${n}`));
    expect(parseResolution({ candidates: [britannia], chain: { name: "X", outlets: many } })).toEqual({ ok: false, problem: "too_many_outlets" });
  });

  it("survives sealing", () => {
    const keys = generateReplyKeys();
    const parsed = parseResolution({ candidates: [britannia], chain: { name: "The Bombay Cartel", outlets: [outlet(19.1, "Bandra")] } });
    if (!parsed.ok) throw new Error("expected ok");
    expect(openResolverResult(sealResolverResult(parsed.result, keys.publicKey), keys)).toEqual(parsed.result);
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
