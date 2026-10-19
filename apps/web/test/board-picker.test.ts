import { describe, expect, it } from "vitest";
import { pickBoard } from "../lib/places/boards";

const boards = [
  { id: "p", name: "Personal", kind: "personal" },
  { id: "m", name: "Public", kind: "master" },
  { id: "a", name: "Duo", kind: "group" },
  { id: "b", name: "Four", kind: "group" },
] as const;

describe("pickBoard", () => {
  it("keeps Personal and Public on their own", () => {
    expect(pickBoard(boards, ["p"], "m")).toEqual(["m"]);
    expect(pickBoard(boards, ["a", "b"], "p")).toEqual(["p"]);
    expect(pickBoard(boards, ["m"], "a")).toEqual(["a"]);
  });

  it("lets groups be picked together, keeping one", () => {
    expect(pickBoard(boards, ["a"], "b")).toEqual(["a", "b"]);
    expect(pickBoard(boards, ["a", "b"], "a")).toEqual(["b"]);
    expect(pickBoard(boards, ["b"], "b")).toEqual(["b"]);
  });
});
