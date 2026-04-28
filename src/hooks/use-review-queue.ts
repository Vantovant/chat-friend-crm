// Read-only data hooks for the Review Queue.
// IMPORTANT: This file MUST contain zero writes — no .insert / .update / .delete /
// functions.invoke calls. Verified by the safety grep gate before merge.
// Triage writes live in src/hooks/use-triage-action.ts.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  type ConfidenceBand,
  type ProposalStatus,
  type RiskLevel,
  type TriageState,
  confidenceBand,
} from '@/lib/review-queue-utils';

export interface ProposalRow {
  id: string;
  action_type: string;
  status: string;
  risk_level: string;
  confidence: number;
  contact_id: string | null;
  proposed_diff: any;
  evidence: any;
  created_by_label: string;
  created_at: string;
  requires_review: boolean;
  auto_applied: boolean;
  triage_state: TriageState;
  review_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  // joined / resolved
  contact_name: string | null;
  contact_phone_normalized: string | null;
  contact_email: string | null;
  contact_current_lead_type: string | null;
  reviewed_by_name?: string | null;
}

export interface ProposalFilters {
  statuses: ProposalStatus[];
  actionTypes: string[];
  bands: ConfidenceBand[];
  risks: RiskLevel[];
  triageStates: TriageState[];
  fromDate: string | null;
  toDate: string | null;
}

export const DEFAULT_FILTERS: ProposalFilters = {
  statuses: ['pending'],
  actionTypes: [],
  bands: [],
  risks: [],
  triageStates: [],
  fromDate: null,
  toDate: null,
};

/** Page-1 list of proposals with applied filters. Read-only. */
export function useProposals(filters: ProposalFilters, pageSize = 25) {
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);

      // SELECT-only query against zazi_actions.
      let q = supabase
        .from('zazi_actions')
        .select('id, action_type, status, risk_level, confidence, contact_id, proposed_diff, evidence, created_by_label, created_at, requires_review, auto_applied, triage_state, review_notes, reviewed_at, reviewed_by')
        .order('created_at', { ascending: false })
        .limit(pageSize);

      if (filters.statuses.length > 0) q = q.in('status', filters.statuses);
      if (filters.actionTypes.length > 0) q = q.in('action_type', filters.actionTypes);
      if (filters.risks.length > 0) q = q.in('risk_level', filters.risks);
      if (filters.triageStates.length > 0) q = q.in('triage_state', filters.triageStates);
      if (filters.fromDate) q = q.gte('created_at', filters.fromDate);
      if (filters.toDate) q = q.lte('created_at', filters.toDate);

      const { data, error: qErr } = await q;
      if (cancelled) return;

      if (qErr) {
        setError(qErr.message);
        setRows([]);
        setLoading(false);
        return;
      }

      const proposals = (data || []) as any[];

      // Client-side band filter (band is derived, not a column)
      const bandFiltered = filters.bands.length > 0
        ? proposals.filter(p => filters.bands.includes(confidenceBand(p.confidence)))
        : proposals;

      // Resolve contacts in one query
      const contactIds = Array.from(new Set(bandFiltered.map(p => p.contact_id).filter(Boolean))) as string[];
      let contactMap: Record<string, { name: string; phone_normalized: string | null; email: string | null; lead_type: string | null }> = {};
      if (contactIds.length > 0) {
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('id, name, phone_normalized, email, lead_type')
          .in('id', contactIds);
        for (const c of contactsData || []) {
          contactMap[(c as any).id] = {
            name: (c as any).name,
            phone_normalized: (c as any).phone_normalized,
            email: (c as any).email,
            lead_type: (c as any).lead_type,
          };
        }
      }

      const merged: ProposalRow[] = bandFiltered.map(p => ({
        ...p,
        contact_name: p.contact_id ? contactMap[p.contact_id]?.name ?? null : null,
        contact_phone_normalized: p.contact_id ? contactMap[p.contact_id]?.phone_normalized ?? null : null,
        contact_email: p.contact_id ? contactMap[p.contact_id]?.email ?? null : null,
        contact_current_lead_type: p.contact_id ? contactMap[p.contact_id]?.lead_type ?? null : null,
      }));

      setRows(merged);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [filterKey, pageSize, refreshKey]);

  return { rows, loading, error, refetch: () => setRefreshKey(k => k + 1) };
}

/** Distinct action_types currently present (small list, populates filter chips). */
export function useDistinctActionTypes() {
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('zazi_actions')
        .select('action_type')
        .limit(1000);
      if (cancelled) return;
      const uniq = Array.from(new Set((data || []).map((r: any) => r.action_type))).sort();
      setTypes(uniq as string[]);
    })();
    return () => { cancelled = true; };
  }, []);
  return types;
}

export interface ProposalDetail {
  proposal: ProposalRow;
  activity: {
    id: string;
    type: string;
    performed_by: string | null;
    performed_by_name: string | null;
    metadata: any;
    created_at: string;
  } | null;
  webhookEvent: {
    id: string;
    source: string;
    action: string;
    status: string;
    created_at: string;
    payload: any;
  } | null;
  idempotency: {
    idempotency_key: string;
    action: string;
    created_at: string;
    status_code: number | null;
  } | null;
}

/** Best-effort detail loader. Any missing link is reported as null. Read-only. */
export function useProposalDetail(proposal: ProposalRow | null) {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!proposal) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Mirrored contact_activity row by metadata.proposal_id
      const { data: actData } = await supabase
        .from('contact_activity')
        .select('id, type, performed_by, metadata, created_at')
        .eq('type', 'lead_type_proposal')
        .filter('metadata->>proposal_id', 'eq', proposal.id)
        .limit(1)
        .maybeSingle();

      let performedByName: string | null = null;
      if ((actData as any)?.performed_by) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', (actData as any).performed_by)
          .maybeSingle();
        performedByName = (prof as any)?.full_name ?? null;
      }

      // Best-effort webhook_events match via payload_hash from evidence summary
      let webhookEvent: ProposalDetail['webhookEvent'] = null;
      const payloadHash = proposal?.evidence?.summary?.hash ?? null;
      if (payloadHash) {
        const { data: ev } = await supabase
          .from('webhook_events')
          .select('id, source, action, status, created_at, payload')
          .filter('payload->>payload_hash', 'eq', payloadHash)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ev) webhookEvent = ev as any;
      }

      // Best-effort idempotency match via payload_hash
      let idempotency: ProposalDetail['idempotency'] = null;
      if (payloadHash) {
        const { data: idem } = await supabase
          .from('webhook_idempotency_keys')
          .select('idempotency_key, action, created_at, status_code')
          .eq('payload_hash', payloadHash)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (idem) idempotency = idem as any;
      }

      if (cancelled) return;
      setDetail({
        proposal,
        activity: actData ? { ...(actData as any), performed_by_name: performedByName } : null,
        webhookEvent,
        idempotency,
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [proposal?.id]);

  return { detail, loading };
}
