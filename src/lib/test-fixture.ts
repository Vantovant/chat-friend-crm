/**
 * Test fixture detection — Norah Incident Closure (2026-05-02).
 *
 * A "test fixture" is any seeded message/contact created for QA of Level 3A
 * or other automation, which must be visually isolated from real customer
 * traffic in the production Inbox and Prospector Drafts.
 *
 * Detection rules (any one is sufficient):
 *   1. Contact has the tag `test:fixture`
 *   2. Contact name starts with `[TEST]`
 *   3. Message content starts with `[TEST]`
 *   4. Message provider_message_id starts with `TEST-FIXTURE-`
 *   5. ai_suggestions.content.is_test_fixture === true
 *
 * Forbidden: this module MUST NEVER be used to hide real customer messages.
 * The detection is purely additive — it tags rows for the UI to render
 * differently or filter under the Test/QA view.
 */

export const TEST_FIXTURE_TAG = 'test:fixture';
export const TEST_CONTENT_PREFIX = '[TEST]';
export const TEST_PROVIDER_PREFIX = 'TEST-FIXTURE-';

export function isTestFixtureContact(contact?: {
  name?: string | null;
  tags?: string[] | null;
} | null): boolean {
  if (!contact) return false;
  if ((contact.tags || []).includes(TEST_FIXTURE_TAG)) return true;
  if ((contact.name || '').trim().startsWith(TEST_CONTENT_PREFIX)) return true;
  return false;
}

export function isTestFixtureMessage(msg?: {
  content?: string | null;
  provider_message_id?: string | null;
} | null): boolean {
  if (!msg) return false;
  if ((msg.content || '').trimStart().startsWith(TEST_CONTENT_PREFIX)) return true;
  if ((msg.provider_message_id || '').startsWith(TEST_PROVIDER_PREFIX)) return true;
  return false;
}

export function isTestFixtureDraftContent(content: any): boolean {
  return !!(content && content.is_test_fixture === true);
}

export type FixtureFilter = 'live' | 'test' | 'all';
