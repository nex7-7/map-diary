import type { Board, DiarySnapshot, PlaceView, TagDefinition } from "./types";

/**
 * Who sees what. A board shows only opinions from its own members; a group also shows its
 * members' master-board opinions. Everything here runs on decrypted data on the device.
 */

export const isMember = (board: Board, accountId: string): boolean =>
  board.memberIds === null || board.memberIds.includes(accountId);

/** The known boards an item is posted to whose members include its author: its badges. */
export function badgesFor(authorId: string, postedTo: readonly string[], boards: readonly Board[]): string[] {
  return postedTo.filter((id) => {
    const board = boards.find((b) => b.id === id);
    return board !== undefined && isMember(board, authorId);
  });
}

/**
 * The boards whose view shows an item: each known board the author belongs to that it is
 * posted to, plus every group the author belongs to when it is posted to master.
 */
export function shownOn(authorId: string, postedTo: readonly string[], boards: readonly Board[]): string[] {
  const onMaster = boards.some((b) => b.kind === "master" && postedTo.includes(b.id));
  return boards
    .filter((b) => isMember(b, authorId) && (postedTo.includes(b.id) || (b.kind === "group" && onMaster)))
    .map((b) => b.id);
}

/**
 * True when everyone who can read `board` can also read something posted to `postedTo`, so
 * posting there reaches nobody new. `null` members means everyone on the app.
 */
export function audienceWithin(board: Board, postedTo: readonly string[], boards: readonly Board[]): boolean {
  const reached = boards.filter((b) => postedTo.includes(b.id));
  if (reached.some((b) => b.memberIds === null)) return true;
  if (board.memberIds === null) return false;
  return board.memberIds.every((m) => reached.some((b) => isMember(b, m)));
}

/** Applies the board rules to a snapshot built from raw posted boards. */
export function applyBoardRules(snapshot: DiarySnapshot): DiarySnapshot {
  const { boards } = snapshot;
  const places = snapshot.places.map((p): PlaceView => ({
    ...p,
    boards: p.boards.filter((id) => boards.some((b) => b.id === id)),
    opinions: p.opinions
      .map((o) => ({ ...o, boards: badgesFor(o.authorId, o.boards, boards), shownOn: shownOn(o.authorId, o.boards, boards) }))
      .filter((o) => o.shownOn.length > 0),
  }));
  const tags = snapshot.tags
    .map((t): TagDefinition => ({ ...t, boards: badgesFor(t.authorId, t.boards, boards) }))
    .filter((t) => t.boards.length > 0);
  return { ...snapshot, places, tags };
}

/**
 * The boards the device owner may post an opinion on `place` to: boards they belong to,
 * whose readers can all see the place. Personal comes first, as the default.
 */
export function opinionBoards(snapshot: DiarySnapshot, place: PlaceView): Board[] {
  return snapshot.boards
    .filter((b) => isMember(b, snapshot.me.id) && audienceWithin(b, place.boards, snapshot.boards))
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name));
}

const kindOrder: Record<Board["kind"], number> = { personal: 0, group: 1, master: 2 };

export interface TagFit {
  /** Chosen boards where the tag's definition is visible. */
  fits: string[];
  /** Chosen boards where it is not. */
  outside: string[];
  /** The owner wrote the definition, so they can widen it to `outside`. */
  canWiden: boolean;
}

/** A tag opinion may only go to boards where its definition is visible. */
export function tagFit(def: TagDefinition, chosen: readonly string[], snapshot: DiarySnapshot): TagFit {
  const fits: string[] = [];
  const outside: string[] = [];
  for (const id of chosen) {
    const board = snapshot.boards.find((b) => b.id === id);
    if (board && audienceWithin(board, def.boards, snapshot.boards)) fits.push(id);
    else outside.push(id);
  }
  return { fits, outside, canWiden: def.authorId === snapshot.me.id };
}

export function boardName(snapshot: DiarySnapshot, id: string): string {
  return snapshot.boards.find((b) => b.id === id)?.name ?? "Board";
}

/**
 * The boards picked after a tap on `id`. Personal and Public each stand alone (Public already
 * reaches the person's own list and every group's), while groups can be picked together.
 * Something always stays picked.
 */
export function pickBoard(boards: readonly Pick<Board, "id" | "kind">[], value: readonly string[], id: string): string[] {
  const isGroup = (v: string) => boards.find((b) => b.id === v)?.kind === "group";
  if (!isGroup(id)) return [id];
  const groups = value.filter(isGroup);
  const next = groups.includes(id) ? groups.filter((v) => v !== id) : [...groups, id];
  return next.length > 0 ? next : [...value];
}
