# ADR-0001: Repo dedicato per l'e2e, ambiente preso a prestito da onepiece-infrastructure

## Contesto

Il progetto è diviso in un repo per componente (`one-piece-user-service`,
`one-piece-user-frontend`, `onepiece-infrastructure`), ciascuno responsabile
solo del proprio dominio:

- `one-piece-user-service` possiede già test unit e slice/integration
  (`@WebMvcTest`, `@DataJpaTest` con Testcontainers) che validano la propria
  logica interna.
- `onepiece-infrastructure` possiede l'orchestrazione dell'intero stack
  locale (Postgres, Keycloak, oauth2-proxy, user-service, user-frontend) via
  Helmfile su un cluster kind, e un proprio smoke test (`scripts/02-smoke-test.sh`)
  che valida il wiring del flow OAuth 2.0 Authorization Code + PKCE.

Mancava un livello che verificasse un flow utente reale end-to-end
attraverso tutti i componenti insieme (login → `/me` → logout), dal punto di
vista del browser.

## Decisione

1. **Repo dedicato `one-piece-e2e`**, non annesso a `one-piece-user-frontend`
   né a `onepiece-infrastructure`.
2. **L'ambiente non viene reimplementato**: la CI di questo repo fa checkout
   di `onepiece-infrastructure` e invoca i suoi script esistenti
   (`scripts/setup.sh` / `scripts/teardown.sh`), esattamente come farebbe uno
   sviluppatore in locale.
3. **Un cluster kind nuovo per ogni run**, creato da `setup.sh` e distrutto da
   `teardown.sh` a fine job (`if: always()`).
4. **Ambiente `ci` di Helmfile**: le immagini vengono tirate da GHCR (le
   stesse pubblicate dalle CI di `user-service`/`user-frontend`), non
   ribuildate localmente — si testa l'artefatto reale, non un suo sostituto.

## Alternative considerate

- **E2E nel repo frontend**: scartata. Avrebbe richiesto che il repo più "a
  valle" (il consumer) orchestrasse il build/deploy di tutto ciò che sta a
  monte (backend, DB, identity provider) — l'inverso della dipendenza che
  repo-per-componente vuole garantire. In più, un fallimento causato da un
  cambio nel backend sarebbe visibile solo nella CI di un altro repo.
- **E2E dentro `onepiece-infrastructure`**: scartata per ora. Quel repo è
  bash/YAML/Helm; introdurre un runtime Node/Playwright e asserzioni sul
  comportamento applicativo (non sul wiring infra) ne allargherebbe lo scope
  oltre "deployment e gestione infrastruttura".
- **Reusable GitHub Actions workflow** (`workflow_call`) esposto da
  `onepiece-infrastructure` invece di checkout diretto + invocazione script:
  interfaccia più pulita, ma introdotta solo se un secondo consumer (oltre a
  questo repo) avrà bisogno dello stesso "dammi un ambiente pronto" — non
  c'è ancora un bisogno concreto.
- **Reset di stato applicativo tra i singoli test** (invece di un cluster per
  test) invece di un cluster ephemeral per l'intero run: scartata per costo
  (Helmfile sync impiega minuti). L'isolamento tra singoli test si ottiene
  con dati univoci per test (utenti/email diversi), non con reset
  dell'infrastruttura.

## Conseguenze

- Questo repo dipende dall'esistenza e dalla stabilità degli script di
  `onepiece-infrastructure`: un cambiamento lì (es. rinominare uno script)
  rompe silenziosamente questa CI finché non viene aggiornata.
- Le versioni pinnate di kind/kubectl/helm/helmfile nel workflow di questo
  repo sono duplicate da `onepiece-infrastructure/.github/workflows/test-infrastructure.yml`
  e vanno aggiornate insieme, manualmente, finché non si introduce
  l'alternativa "reusable workflow".
- I secret `GHCR_PULL_USERNAME`/`GHCR_PULL_TOKEN` sono definiti a livello
  organizzazione (`one-piece-api`), non duplicati per repository: la loro
  policy di "repository access" deve includere questo repo perché
  `${{ secrets.* }}` li risolva nel workflow. Essendo `one-piece-e2e`
  pubblico, la policy va impostata esplicitamente su *All repositories* o su
  *Selected repositories* con questo repo incluso — *Private repositories*
  lo escluderebbe.
- "Ambiente pulito" è garantito strutturalmente (cluster ricreato da zero a
  ogni run), non da logica di reset nei test: i singoli test devono comunque
  restare isolati tra loro tramite dati univoci, non assumere un cluster
  vuoto per ogni test.
