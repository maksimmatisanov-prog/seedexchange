import { validateLaunchReadiness, type LaunchPhase, type LaunchReadiness } from '../src/domain/launch.js';

const readyUrl = process.argv[2];
const expectedPhase = process.argv[3];
const expectedMigration = process.argv[4];

if (!readyUrl || !['discovery', 'commerce'].includes(expectedPhase) || !expectedMigration) {
  throw new Error('Usage: verify-ready <ready-url> <discovery|commerce> <expected-migration.sql>');
}

let lastError: unknown;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Readiness returned HTTP ${response.status}.`);
    const body = await response.json() as LaunchReadiness;
    const errors = validateLaunchReadiness(body, expectedPhase as LaunchPhase, expectedMigration);
    if (errors.length) throw new Error(errors.join(' '));
    console.log(JSON.stringify({ verified: true, attempt, ...body }));
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

if (lastError) throw lastError;
