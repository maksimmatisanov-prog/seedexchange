import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = path.resolve('.github/workflows/ci.yml');

describe('GitHub verification workflow', () => {
  it('isolates mutating acceptance media under the runner temporary directory', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    const mediaRoot = '/tmp/seedexchange-media-${{ github.run_id }}-${{ github.run_attempt }}';

    expect(workflow).toContain('TEST_DATABASE_URL: postgresql://seedexchange:seedexchange_test@127.0.0.1:5432/seedexchange_test');
    expect(workflow).toContain(`MEDIA_ROOT: ${mediaRoot}`);
    expect(workflow).toContain(`TEST_MEDIA_ROOT: ${mediaRoot}`);
    expect(workflow).toContain("PLAYWRIGHT_MUTATING_ACCEPTANCE: '1'");
  });

  it('builds and uploads production artifacts only from a master push', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    const condition = "if: github.event_name == 'push' && github.ref == 'refs/heads/master'";

    expect(workflow.split(condition)).toHaveLength(3);
  });
});
