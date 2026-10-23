/**
 * What another app shared to the diary (the manifest's share target), as one piece of text for
 * the Add sheet. Apps fill `title`, `text` and `url` differently: Google Maps puts the name,
 * address and link all in `text`, a browser puts the page in `url`. Repeats are dropped.
 */
export function sharedText(params: URLSearchParams): string {
  const text = params.get("text")?.trim() ?? "";
  const url = params.get("url")?.trim() ?? "";
  const title = params.get("title")?.trim() ?? "";
  const parts: string[] = [];
  if (title && !text.includes(title)) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);
  return parts.join("\n");
}

/** The Add sheet for shared text. The text rides in the fragment, which never reaches the server. */
export function addHrefFor(text: string): string {
  return text ? `/add#${new URLSearchParams({ text })}` : "/add";
}
