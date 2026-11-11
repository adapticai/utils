/**
 * Alpaca's article id, carried onto the simplified news shape.
 *
 * Every simplified article is built from a vendor payload that names the
 * article by a numeric id. That id is the only key that is the same on every
 * fetch of the same article and the same in every store that keyed the
 * article by the vendor's name for it, so a consumer that joins a fetched
 * article to anything else needs it. A shape built without it forces the
 * consumer to synthesise a key of its own (from the URL, say), and a
 * synthesised key matches nothing a vendor-keyed store holds.
 *
 * An id that is not a finite whole number is not an id: the field is left
 * absent, so the consumer sees an article it cannot key rather than a key
 * that names nothing.
 *
 * @module alpaca/news-article-id
 */

import type { SimpleNews } from "../types/alpaca-types";

/**
 * The `id` field of a simplified article, or no field at all.
 *
 * @param article - The vendor payload, read only for its id.
 * @param article.id - The vendor's id for the article.
 * @returns `{ id }` when the payload's id is a finite whole number, otherwise
 *   an empty object, so spreading it never writes `id: undefined`.
 */
export function articleIdOf(article: {
  readonly id?: unknown;
}): Pick<SimpleNews, "id"> {
  const { id } = article;
  return typeof id === "number" && Number.isSafeInteger(id) ? { id } : {};
}
