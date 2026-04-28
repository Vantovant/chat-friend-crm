// Phase 4A Step 2 — triage writes ONLY.
// This hook is the SINGLE place in the codebase allowed to mutate zazi_actions
// (and only the triage_state / review_notes / reviewed_at / reviewed_by columns).
// The DB trigger zazi_actions_triage_guard_trg blocks any other column changes
// even if this code is bypassed. RLS limits this to admin / super_admin.
//
// HARD RULES enforced here:
// - Never updates contacts.
// - Never changes zazi_actions.status.
// - Never sends WhatsApp.
// - Writes one audit row to contact_activity (type = 'proposal_triaged') per real change.
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TriageState } from '@/lib/review-queue-utils';

export interface TriagePayload {
  proposalId: string;
  contactId: string | null;
  triageState: TriageState;
  reviewNotes?: string | null;
  /** When true, only saves the note (does not change triage_state). */
  noteOnly?: boolean;
  /** Previous triage state for audit trail. */
  previousTriageState?: TriageState;
}

export function useTriageAction() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (payload: TriagePayload): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const { data: userResp } = await supabase.auth.getUser();
      const userId = userResp?.user?.id ?? null;
      if (!userId) {
        setError('Not signed in.');
        return false;
      }

      const updatePatch: Record<string, any> = {
        review_notes: payload.reviewNotes ?? null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
      };
      if (!payload.noteOnly) {
        updatePatch.triage_state = payload.triageState;
      }

      const { error: upErr } = await supabase
        .from('zazi_actions')
        .update(updatePatch)
        .eq('id', payload.proposalId);

      if (upErr) {
        setError(upErr.message);
        return false;
      }

      // Best-effort audit row (proposal_triaged). Never touches contacts table itself.
      if (payload.contactId) {
        await supabase.from('contact_activity').insert({
          contact_id: payload.contactId,
          performed_by: userId,
          type: 'proposal_triaged',
          metadata: {
            proposal_id: payload.proposalId,
            triage_state: payload.noteOnly ? payload.previousTriageState ?? null : payload.triageState,
            note_only: !!payload.noteOnly,
            previous_triage_state: payload.previousTriageState ?? null,
            note_present: !!payload.reviewNotes,
            phase: '4A.step2',
          },
        });
      }

      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Triage update failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { submit, saving, error };
}
