import { APIRequestContext, expect } from '@playwright/test';

/**
 * Mailpit's HTTP API (onepiece-infrastructure ADR-0008): in the "ci" environment every
 * email Keycloak sends lands there instead of a real inbox. Reached through a
 * port-forward, like Keycloak and oauth2-proxy (see .github/workflows/e2e.yml).
 */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSearchResult {
  messages: Array<{ ID: string }>;
}

interface MailpitMessage {
  HTML: string;
}

/**
 * Waits for the invitation email sent to `email` and returns the Keycloak action link it
 * carries (the "execute actions" token, UF-IDU-01). Emails go out asynchronously, so the
 * search is polled until the message shows up.
 */
export async function invitationLink(request: APIRequestContext, email: string): Promise<string> {
  let messageId = '';
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${email}"` },
        });
        const result: MailpitSearchResult = await response.json();
        messageId = result.messages[0]?.ID ?? '';
        return messageId;
      },
      { message: `no email to ${email} in Mailpit`, timeout: 15_000 },
    )
    .not.toBe('');

  const message: MailpitMessage = await (
    await request.get(`${MAILPIT_URL}/api/v1/message/${messageId}`)
  ).json();
  const link = message.HTML.match(/href="([^"]*\/login-actions\/action-token[^"]*)"/)?.[1];
  if (!link) {
    throw new Error(`No action link in the invitation email to ${email}`);
  }
  return link.replaceAll('&amp;', '&');
}
