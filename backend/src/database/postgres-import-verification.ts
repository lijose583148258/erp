export type ImportedCountVerification = {
  name: string;
  expectedRowCount: number;
  actualRowCount: number;
  matches: boolean;
};

export function assertImportedCountsMatch(results: ImportedCountVerification[]) {
  const mismatches = results.filter((table) => !table.matches);
  if (mismatches.length === 0) return;

  const summary = mismatches
    .map((table) => `${table.name}: expected ${table.expectedRowCount}, got ${table.actualRowCount}`)
    .join('; ');
  throw new Error(`PostgreSQL import verification failed before commit: ${summary}`);
}
