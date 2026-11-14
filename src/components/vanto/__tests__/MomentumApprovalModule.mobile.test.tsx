import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const LONG = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long teaching message.`).join('\n');
const mk = (n: number, status: string) => ({ id: `id${n}`, kind: 'teaching', title: `Teaching ${n}`, status, version: 1, held: false, held_reason: null, source_slug: null, source_changed: false, rejected_reason: null, approved_at: null, body_sha256: `sha${n}`, deliveries: [] });
const items = [mk(1, 'draft'), mk(2, 'in_review'), mk(3, 'in_review'), mk(4, 'in_review'), mk(5, 'in_review'), mk(6, 'in_review'), mk(7, 'approved'), mk(8, 'in_review')];

vi.mock('@/hooks/use-current-user', () => ({ useCurrentUser: () => ({ role: 'super_admin' }) }));
const stable = (() => {
  const clearError = () => {};
  const run = async (action: string, body?: any) => {
      if (action === 'list') return { items };
      if (action === 'status') return { settings: { momentum_nugget_target_groups: JSON.stringify([{ name: 'Duplication Movement', jid: 'j1' }]) } };
      if (action === 'get') { const it = items.find((i) => i.id === body.item_id)!; return { item: { body: LONG, body_sha256: it.body_sha256 }, source: null }; }
      return {};
  };
  return { busy: false, error: null, clearError, run };
})();
vi.mock('@/hooks/use-momentum-admin', () => ({ useMomentumAction: () => stable }));

import { MomentumApprovalModule } from '../MomentumApprovalModule';

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w });
beforeEach(() => { cleanup(); window.HTMLElement.prototype.scrollIntoView = vi.fn(); });

describe('Momentum Messages tab', () => {
  it('has its own scroll container (main area clips overflow)', async () => {
    setWidth(393);
    const { container } = render(<MomentumApprovalModule />);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/h-full/);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/overflow-y-auto/);
  });

  it('mobile (393px): panel opens directly under the selected card, incl. the LAST card, with full text and actions', async () => {
    setWidth(393);
    render(<MomentumApprovalModule />);
    for (const n of [2, 8]) {
      const card = (await screen.findByText(`Teaching ${n}`, { selector: 'div.text-sm.font-medium' })).closest('button')!;
      fireEvent.click(card);
      await waitFor(() => expect(screen.getByText(/Line 60 of a long/)).toBeTruthy());
      const wrapper = card.parentElement!;
      expect(wrapper.contains(screen.getByText(/Line 60 of a long/))).toBe(true); // inside the same wrapper => directly below card
      expect(card.nextElementSibling?.textContent).toMatch(/exact text that will be sent/);
      const pre = screen.getByText(/Line 60 of a long/).closest('pre')!;
      expect(pre.className).not.toMatch(/(^|\s)max-h-80/); // no inner height cap on phones
      expect(screen.getByRole('button', { name: /Approve this exact text/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Reject/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Hold/ })).toBeTruthy();
      expect(screen.getAllByText(/exact text that will be sent/).length).toBe(1); // exactly one panel
    }
  });

  it('mobile: approved item shows scheduling controls in the panel', async () => {
    setWidth(393);
    render(<MomentumApprovalModule />);
    fireEvent.click((await screen.findByText('Teaching 7', { selector: 'div.text-sm.font-medium' })).closest('button')!);
    await waitFor(() => expect(screen.getByText(/Schedule \(does not send/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeTruthy();
    expect(screen.getByText('Duplication Movement')).toBeTruthy();
  });

  it('mobile: draft shows Send for review (Approve appears only after review)', async () => {
    setWidth(393);
    render(<MomentumApprovalModule />);
    fireEvent.click((await screen.findByText('Teaching 1', { selector: 'div.text-sm.font-medium' })).closest('button')!);
    await waitFor(() => expect(screen.getByRole('button', { name: /Send for review/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Approve this exact text/ })).toBeNull();
  });

  it('desktop (1280px): unchanged two-column layout, panel in right column, none under the card', async () => {
    setWidth(1280);
    const { container } = render(<MomentumApprovalModule />);
    const card = (await screen.findByText('Teaching 2', { selector: 'div.text-sm.font-medium' })).closest('button')!;
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByText(/Line 60 of a long/)).toBeTruthy());
    expect(card.parentElement!.contains(screen.getByText(/Line 60 of a long/))).toBe(false);
    const right = screen.getByText(/Line 60 of a long/).closest('div.hidden.md\\:block');
    expect(right).toBeTruthy();
    expect(screen.getByText(/Line 60 of a long/).closest('pre')!.className).toMatch(/md:max-h-80/);
    expect(container.querySelector('.md\\:grid-cols-\\[320px_1fr\\]')).toBeTruthy();
    expect(screen.getAllByText(/exact text that will be sent/).length).toBe(1);
  });
});
