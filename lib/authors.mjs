// pat-archive/lib/authors.mjs
export function addAuthorName(list, name){
  const n = (name||"").trim();
  if(!n || list.includes(n)) return list;
  return [...list, n];
}
export function removeAuthorName(list, name){
  return list.filter(x => x !== name);
}
