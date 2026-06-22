export const presenceTarget = {
  cell: (itemId: string, columnId: string) => `cell:${itemId}:${columnId}`,
  card: (itemId: string) => `card:${itemId}`,
  event: (itemId: string) => `event:${itemId}`,
  field: (itemId: string, fieldKey: string) => `field:${itemId}:${fieldKey}`,
} as const;
