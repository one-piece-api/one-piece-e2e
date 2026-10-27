# one-piece-e2e

Test end-to-end del sistema **One Piece API**: verificano flow utente reali
attraverso l'intero stack — Keycloak, oauth2-proxy, `user-service`,
`content-service`, `user-frontend` — non un singolo componente isolato.

| Spec | Flow |
|---|---|
| `login`, `delete-account` | accesso, profilo, logout, cancellazione account |
| `admin-user-list`, `invite-user`, `resend-invitation` | gestione equipaggio (ADMIN) |
| `editorial-loop` | workflow editoriale dei contenuti, un utente seed per ruolo |
| `public-api` | contenuto pubblicato letto dall'API pubblica, redirect dello slug, ritiro |
| `devil-fruit-loop` | frutto con immagine legato al tipo, azioni bloccate, frutto e tipo nell'API pubblica |
| `devil-fruit-subcategories` | tipo con sottocategorie, frutto che ne sceglie una, API pubblica, versione del tipo rifiutata se toglie una sottocategoria in uso |
| `story-structure-loop` | catena Saga → Arco → Volume → Capitolo → Episodio via API del content-service (sessioni reali), publish in ordine, intervalli/date solo da contenuti online (solo JP), filtri e blocchi `RELATED_NOT_ONLINE` / `ONLINE_ITEMS_LINKED` |
| `bounty-loop` | taglia con poster che ne sostituisce un'altra (UI: catena, validità, filtri, ordine per importo, taglia ritirata), API pubblica; via API: un solo successore, nessun ciclo, `previous` non online |
| `affiliation-loop` | affiliazione con tipo e bandiera (UI: bozza, revisione, pubblicazione), API pubblica in due lingue con bandiera raggiungibile, lista per nome e filtro per tipo, romaji duplicato rifiutato (422), capitolo di prima apparizione non ritirabile finché è online (409 `ONLINE_ITEMS_LINKED`), affiliazione ritirata |
| `species-loop` | specie con immagine (UI: bozza, revisione, pubblicazione), API pubblica in due lingue con immagine raggiungibile, lista per nome, romaji duplicato rifiutato (422), specie in `/species/linkable`, capitolo di prima apparizione non ritirabile finché è online (409 `ONLINE_ITEMS_LINKED`), specie ritirata |
| `character-loop` | personaggio con ritratto, specie, epiteti, alias e compleanno (UI: bozza, revisione, pubblicazione), API pubblica in due lingue (epiteti nella lingua del lettore, specie e alias nell'ordine dell'editor, `--MM-DD`, ritratto raggiungibile), filtri per `species` e `status`, specie non ritirabile finché il personaggio è online (409 `ONLINE_ITEMS_LINKED`); via API: romaji duplicato (422), alias duplicato (422 `aliases[1]`), epiteto mancante in una lingua che blocca l'invio (422 `epithets[0].text[en]`) |
| `character-relations` | relazioni del personaggio (taglie, appartenenze, Frutti del Diavolo): titolare scelto nell'editor della taglia (UI: scheda, colonna e filtro `holder`, conteggio e sezione nel personaggio), API pubblica (`holder` della taglia, `bounties` del personaggio), personaggio non ritirabile finché una taglia è online (409 `ONLINE_ITEMS_LINKED`); via API: titolare non approvato (422 `holder`), taglia online prima del titolare (409 `RELATED_NOT_ONLINE`); Frutti del Diavolo: un solo possessore attuale per frutto (409 `DEVIL_FRUIT_IN_USE` alla pubblicazione, ok dopo averlo segnato `former`), frutto con più possessori (`multipleUsers`), API pubblica (`devilFruits` del personaggio, `users` del frutto, filtro `devilFruit`), scheda e conteggio dei possessori nel frutto; appartenenze con ruolo e grado di Marina (UI: editor e scheda, filtri `affiliation` e `affiliationKind`, API pubblica), grado fuori dalla Marina rifiutato (422) e affiliazione che lascia la Marina mentre ha gradi (409 `MARINE_RANK_IN_USE`); parenti memorizzati una volta e letti da entrambi i lati (UI: tipo inverso e etichette per genere sulla scheda, API pubblica dei due lati), legame inverso rifiutato (422), sé stesso rifiutato (422), parente non ritirabile finché è nominato (409 `ONLINE_ITEMS_LINKED`) |

Gli spec dei contenuti usano gli account QA dei contenuti (`chopper`, `vivi`, `law`,
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

`public-api.spec.ts` legge l'API pubblica attraverso Envoy, sulla rotta per host
`api.localhost` (in ogni ambiente, vedi ADR-0024 dell'infra): port-forward al
Service del proxy sulla porta 8090 (`E2E_API_URL`, host in `E2E_API_HOST`):

```bash
kubectl port-forward -n envoy-gateway-system \
  "$(kubectl get svc -n envoy-gateway-system -l app.kubernetes.io/component=proxy -o name)" 8090:80 &
```

## CI

`.github/workflows/e2e.yml` fa checkout di `onepiece-infrastructure`,
esegue `scripts/setup.sh` (ambiente Helmfile `ci`, immagini da GHCR), lancia
la suite, poi distrugge sempre il cluster (`scripts/teardown.sh`) — anche in
caso di fallimento. Richiede i secret `GHCR_PULL_USERNAME` e
`GHCR_PULL_TOKEN`, definiti a livello organizzazione (`one-piece-api`): la
loro "repository access" deve includere questo repo, che è pubblico (quindi
non basta *Private repositories*).
