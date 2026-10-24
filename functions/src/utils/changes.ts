/** True when two stored documents differ in anything but their `updatedAt` time (3.4). */
export function changedIgnoringUpdatedAt(prev: unknown, next: unknown): boolean {
  if (!prev || !next) return true;
  const strip = (doc: any) => JSON.stringify({ ...doc, updatedAt: undefined });
  return strip(prev) !== strip(next);
}
