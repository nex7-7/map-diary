import { AVATAR_PHOTO_MAX, type AvatarPayload } from "../places/payloads";
import { EntryError } from "./actions";

const SIDE = 160;

/**
 * Turns a chosen photo into an avatar: the centre square, shrunk to 160 px and saved as a JPEG
 * small enough to travel inside the encrypted profile item. Runs only in the browser; the photo
 * itself never leaves the device.
 */
export async function photoAvatar(file: Blob): Promise<AvatarPayload> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new EntryError("That file isn't a photo this browser can open. Try a JPEG or PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new EntryError("This browser can't shrink photos.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= AVATAR_PHOTO_MAX) return { kind: "photo", dataUrl };
  }
  throw new EntryError("That photo is too detailed to shrink. Try another one.");
}
