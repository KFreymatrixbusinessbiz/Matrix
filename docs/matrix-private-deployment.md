# Matrix private deployment

Workflow: `.github/workflows/deploy-matrix-private.yml`.

Manual only (`workflow_dispatch`): no push, PR, merge, schedule, or release trigger.
Workflow setup does not deploy anything.

Before an authorized first run, add these repository Actions secrets under
**Settings > Secrets and variables > Actions > New repository secret**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use the existing matrix Worker's real Cloudflare account ID. It is absent from
`wrangler.jsonc`; the workflow requires it to select the account explicitly.
Use a token scoped to that account with Workers Scripts Edit; do not grant DNS
or zone-route editing permissions. Never put credentials in source or chat.
Secret presence, token permissions, and live account access have not been tested.

For a separately authorized deployment, open **Actions > Deploy Matrix private >
Run workflow**, select workflow branch **main**, and supply `deploy_ref`.
Prefer a reviewed full SHA, for example:
`67c61149e2caecb93c366572eff51bb901833eb7`.
The workflow checks out the requested ref, resolves and records its SHA, and
detaches HEAD. Branch/tag inputs resolve at checkout time and can move; use a
full SHA when approval applies to one exact version. Source commits need not
contain this workflow. Empty input never falls back to main.

Node 24 and `npm ci` use the committed npm lockfile. `npm run build` must pass.
Inline checks require dist/index.html and nonempty CSS, reject known tool-output
contamination and internal/evidence-register material, and restrict the existing
Wrangler configuration to the reviewed private target. The current JSON-compatible
`wrangler.jsonc` is parsed as JSON; new syntax or configuration requires review.
Wrangler's existing-Worker deployment listing must succeed before
`npx --no-install wrangler deploy --config wrangler.jsonc` runs.
No direct API deployment fallback is provided.

The job references GitHub Environment `matrix-private` for future protections.
No reviewers or protection rules are assumed configured. Configure required
reviewers and restrict deployment branches to main before granting broader
operator access. The workflow also requires dispatch from main. The concurrency
group `matrix-private-deployment` allows only one active deployment and does not
cancel an active run; GitHub can replace an older pending run with a newer one.

Only trusted, reviewed source may be selected: npm installation/build and the
locked Wrangler executable execute source-controlled code. Cloudflare secrets
are supplied only to the final Worker access/deploy step, not the build steps.
GitHub token permission is contents:read; checkout credentials are not persisted.
Action versions are pinned by SHA. Workflow logs and the job summary record the
requested ref, resolved SHA, build, safety, and deployment outcomes.

Target: existing Worker `matrix`, using the existing config and `dist/`, at
https://matrix.kfrey.workers.dev/. This workflow does not manage production
Matrix/Wix, InPower, DNS, custom domains, or production routes. It does not call
Wix APIs. The workers.dev address is a review endpoint, not an authentication
boundary. Existing account routing must remain restricted to private review;
this workflow does not audit or remove routes configured outside this repository.
