const store = new Map<string, Record<string, number>>();

export function getTransientCounts(documentId: string) {
  return store.get(documentId) ?? {};
}

export function setTransientCounts(documentId: string, value: Record<string, number>) {
  store.set(documentId, value);
}

export function clearTransientCounts(documentId: string) {
  store.delete(documentId);
}
