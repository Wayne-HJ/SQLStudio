import type { DbObject } from "./types.js";

export function matchesObjectSearch(object: DbObject, search: string) {
  const query = search.trim().toLowerCase();
  const name = object.schema ? `${object.schema}.${object.name}` : object.name;
  return name.toLowerCase().includes(query);
}
