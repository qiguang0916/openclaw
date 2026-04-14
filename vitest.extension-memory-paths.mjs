export const memoryExtensionTestRoots = [
  "extensions/memory-core",
  "extensions/mempalace-memory",
  "extensions/memory-lancedb",
  "extensions/memory-wiki",
];

export function isMemoryExtensionRoot(root) {
  return memoryExtensionTestRoots.includes(root);
}
