import fs from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

export const csvSource = {
  name: 'csv',
  async *fetchRows({ filePath }) {
    const csv = await fs.readFile(filePath, 'utf8');
    const delimiter = csv.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
    const rows = parse(csv, { columns: true, skip_empty_lines: true, delimiter, relax_column_count: true });
    yield* rows;
  },
};

