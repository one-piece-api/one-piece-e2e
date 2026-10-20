# one-piece-e2e

Playwright suite over the whole real stack (Keycloak, oauth2-proxy, services, frontend, public API through Envoy). It borrows the environment from `onepiece-infrastructure` (ADR-0001). Specs, prerequisites and port-forwards: `README.md`.

```bash
npm test                          # against http://localhost:4180 (E2E_BASE_URL)
npx playwright test <spec-name>   # one spec
```

- **Local kind cluster and CI only. Never against the remote.**
- One worker, files in sequence: specs share the cluster's state.
- Helpers live in `tests/support/` (`content.ts`, `story.ts`, `bounty.ts`, `public-api.ts`, `crew.ts`, `mailpit.ts`, `png.ts`): reuse them before writing new ones.
- Content specs log in as the QA users `chopper`, `vivi`, `law` (`onepiece-infrastructure/scripts/seed-content-qa-users.sh`) and create uniquely named content on every run.
- `invite-accept`, `resend-invitation` and `admin-user-list` need the `ci` environment (Mailpit, 60 s invitations, fresh Keycloak). On a long-lived local cluster their failures are environmental, not regressions.
- A new user-visible flow gets a spec here; update the README table.
