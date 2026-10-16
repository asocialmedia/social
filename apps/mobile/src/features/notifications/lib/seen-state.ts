export function markNotificationRowsSeen<
  T extends { createdAt: Date | string; read: boolean },
>(rows: T[], seenThrough: number): T[] {
  return rows.map((row) =>
    !row.read &&
    (row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : Date.parse(row.createdAt)) <= seenThrough
      ? { ...row, read: true }
      : row
  );
}
