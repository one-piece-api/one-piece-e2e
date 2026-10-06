# one-piece-e2e

Test end-to-end del sistema **One Piece API**: verificano flow utente reali
attraverso l'intero stack — Keycloak, oauth2-proxy, `user-service`,
`content-service`, `user-frontend` — non un singolo componente isolato.

| Spec | Flow |
|---|---|
| `login`, `delete-account` | accesso, profilo, logout, cancellazione account |
| `admin-user-list`, `invite-user`, `resend-invitation` | gestione equipaggio (ADMIN) |
| `editorial-loop` | workflow editoriale dei contenuti, un utente seed per ruolo |

`editorial-loop` usa gli account QA dei contenuti (`chopper`, `vivi`, `law`,
da `onepiece-infrastructure/scripts/seed-content-qa-users.sh`) e crea a ogni
run un contenuto con nome univoco.

Gli spec di invito richiedono un SMTP funzionante: Mailpit nell'ambiente `ci`,
Resend (con `RESEND_API_KEY`) nell'ambiente `default`.

Perché un repo a parte, e come viene provisionato l'ambiente: vedi
[`docs/adr/0001-e2e-environment-strategy.md`](docs/adr/0001-e2e-environment-strategy.md).

## Prerequisiti

Questo repo **non possiede** l'ambiente: lo prende in prestito da
[`onepiece-infrastructure`](https://github.com/one-piece-api/one-piece-infrastructure).

```bash
# In una checkout di onepiece-infrastructure:
./scripts/setup.sh
kubectl port-forward svc/oauth2-proxy -n auth 4180:4180 &
```

## Esecuzione locale

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

Punta a un ambiente diverso da `http://localhost:4180` con `E2E_BASE_URL`.

`resend-invitation.spec.ts` richiede l'ambiente Helmfile `ci`
(`HELMFILE_ENVIRONMENT=ci ./scripts/setup.sh`), l'unico con un
`keycloak.invitation.token-lifespan` breve (`PT60S` invece di `PT12H`) - vedi
`onepiece-infrastructure/docs/adr/0006-short-invitation-lifespan-in-ci.md`.
Contro un cluster sincronizzato con l'ambiente `default` quel test non vedrà
mai l'invito scadere entro il proprio timeout.

`invite-accept.spec.ts` legge l'email di invito da Mailpit (anche lui solo
nell'ambiente `ci`): serve il port-forward della sua API HTTP, come in CI
(`kubectl port-forward svc/mailpit -n auth 8025:8025`, oppure `E2E_MAILPIT_URL`).

## CI

`.github/workflows/e2e.yml` fa checkout di `onepiece-infrastructure`,
esegue `scripts/setup.sh` (ambiente Helmfile `ci`, immagini da GHCR), lancia
la suite, poi distrugge sempre il cluster (`scripts/teardown.sh`) — anche in
caso di fallimento. Richiede i secret `GHCR_PULL_USERNAME` e
`GHCR_PULL_TOKEN`, definiti a livello organizzazione (`one-piece-api`): la
loro "repository access" deve includere questo repo, che è pubblico (quindi
non basta *Private repositories*).
