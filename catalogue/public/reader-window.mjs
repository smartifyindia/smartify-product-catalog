// Page dimensions and 16px gaps match the reader layout. Prioritise visible pages,
// then their neighbours; callers release canvases outside this window.
export function pageWindow(scrollTop, viewportHeight, pageHeight, pageCount) {
  const current = Math.max(0, Math.min(pageCount - 1, Math.floor((Math.max(0, scrollTop - 16) + 1) / (pageHeight + 16))));
  const end = Math.max(current, Math.min(pageCount - 1, Math.floor((scrollTop + viewportHeight) / (pageHeight + 16))));
  const indices = [];
  for (let index = current; index <= Math.min(pageCount - 1, end + 1); index++) indices.push(index);
  if (current > 0) indices.push(current - 1);
  return { current, indices };
}
