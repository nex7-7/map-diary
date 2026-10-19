import type { DiaryWriter, WriteRequest } from "../lib/entries/actions";
import { snapshotFromItems, type StoredItem } from "../lib/places/items-source";

/** An in-memory stand-in for the device diary: new items go to the Personal board unless boards are given. */
export class FakeDiary implements DiaryWriter {
  readonly device = { accountId: "acct-me", personalBoardId: "board-personal" };
  items = new Map<string, StoredItem>();
  private n = 0;
  async listItems() {
    return [...this.items.values()];
  }
  async write(input: WriteRequest) {
    const id = input.id ?? `i-${++this.n}`;
    const prior = this.items.get(id);
    const now = 1_760_000_000_000 + ++this.n;
    const item: StoredItem = {
      id,
      type: input.type,
      authorId: this.device.accountId,
      placeId: input.placeId,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      boardIds: input.boards ?? prior?.boardIds ?? [this.device.personalBoardId],
      payload: input.payload,
    };
    this.items.set(id, item);
    return item;
  }
  async remove(id: string) {
    this.items.delete(id);
  }
  snapshot() {
    return snapshotFromItems([...this.items.values()], this.device.accountId, this.device.personalBoardId);
  }
}
