import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoutingGraph, edgesForCells } from '../src/routing/graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'graphSnapshot.json');
const processedDir = path.join(__dirname, '..', '..', 'Data', 'processed');

async function main() {
  await loadRoutingGraph({
    mode: 'drive',
    graphPath: path.join(processedDir, 'blr_drive.bgraph'),
    riskPath: path.join(processedDir, 'blr_drive.brisk'),
  });

  // Read the golden fixture
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));

  // Get the seeded cells from the fixture
  const seededCells = fixture.edgesForCellsResults.map((r) => r.cell);

  // Get current edgesForCells results
  const currentResults = seededCells.map((cell) => ({
    cell,
    edgeIds: edgesForCells([cell], 'drive').map((e) => e.id).sort(),
  }));

  // Update the fixture
  fixture.edgesForCellsResults = currentResults;

  // Remove edgeRiskResults (obsolete - was captured when risk file was flat)
  delete fixture.edgeRiskResults;

  // Write back
  await fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2));
  console.log(`Updated golden fixture: ${fixturePath}`);
  console.log(`  edgesForCellsResults: ${currentResults.length} cells updated`);
  console.log(`  edgeRiskResults: removed`);
}

main().catch((e) => { console.error(e); process.exit(1); });