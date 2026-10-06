import { expect, Locator, Page } from '@playwright/test';

/**
 * The Crew Manifest renders one card per user (a CSS grid row), not a table. The card has
 * no semantic role of its own, so it is located by its layout classes plus the text it
 * contains (username or email).
 */
export function crewCards(page: Page): Locator {
  return page.locator('div.grid.items-center');
}

export function crewCard(page: Page, text: string): Locator {
  return crewCards(page).filter({ hasText: text });
}

/**
 * The Crew Manifest link lives in the collapsible "Admin" nav group: open the group first
 * (only when closed - clicking an open group would close it), then follow the link.
 */
export async function openCrewManifest(page: Page): Promise<void> {
  const adminGroup = page.getByRole('button', { name: 'Admin' });
  if ((await adminGroup.getAttribute('aria-expanded')) !== 'true') {
    await adminGroup.click();
  }
  await page.getByRole('link', { name: /Crew Manifest/ }).click();
}

/**
 * Role chips in the invite form are labels wrapping a visually hidden (`sr-only`)
 * checkbox, so a real user clicks the label - Playwright's own `check()` on the input
 * is intercepted by that label.
 */
export async function pickRole(page: Page, role: string): Promise<void> {
  await page.locator('label').filter({ hasText: role }).click();
  await expect(page.getByRole('checkbox', { name: role })).toBeChecked();
}

/**
 * The status badge is rendered twice per card (one per breakpoint, the other hidden by CSS),
 * so only the visible one is the user-facing assertion target.
 */
export function cardStatus(card: Locator, status: string): Locator {
  return card.getByText(status, { exact: true }).locator('visible=true');
}
