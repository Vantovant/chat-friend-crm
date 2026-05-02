import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { temperatureBg, leadTypeBg, leadTypeLabels, LEAD_TYPES, type LeadTemperature, type LeadType } from '@/lib/vanto-data';
import {
  Search, Phone, Video, MoreVertical, Send, Bot, Brain,
  Paperclip, Smile, Info, Loader2, UserCircle, MessageSquare, AlertTriangle, RotateCcw, ArrowLeft, X, Save, Pencil,
} from 'lucide-react';
import { displayPhone } from '@/lib/phone-utils';
import { isTestFixtureContact, type FixtureFilter } from '@/lib/test-fixture';
import { useProfiles, profileLabel, type ProfileOption } from '@/hooks/use-profiles';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CopilotSidebar } from './CopilotSidebar';
import { DictateMessage } from './DictateMessage';


/* ── Types ── */
type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  temperature: LeadTemperature;
  lead_type: LeadType;
  interest: 'high' | 'medium' | 'low';
  tags: string[] | null;
  notes: string | null;
  assigned_to: string | null;
  stage_id: string | null;
};

type Stage = { id: string; name: string; color: string | null; stage_order: number };

type Conversation = {
  id: string;
  contact_id: string;
  status: string;
  unread_count: number;
  last_message: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  contact: Contact;
};

/** WhatsApp 24h customer-care window helpers. */
const WINDOW_MS = 24 * 60 * 60 * 1000;
function getWindowState(lastInboundAt: string | null | undefined) {
  if (!lastInboundAt) return { open: false, hoursLeft: 0, never: true };
  const elapsed = Date.now() - new Date(lastInboundAt).getTime();
  const remaining = WINDOW_MS - elapsed;
  return { open: remaining > 0, hoursLeft: Math.max(0, Math.round(remaining / 3_600_000)), never: false };
}
/** Error codes that mean "retrying the same free-form text will fail again". */
const NON_RETRYABLE_CODES = new Set(['TWILIO_63016', 'TEMPLATE_REQUIRED', 'META_POLICY_BLOCK']);

type Message = {
  id: string;
  conversation_id: string;
  content: string;
  is_outbound: boolean;
  message_type: string;
  status: string | null;
  status_raw: string | null;
  error: string | null;
  created_at: string;
  sent_by: string | null;
};

type InboxFilter = 'accessible' | 'mine' | 'unassigned';

/* ── Main Component ── */
export function InboxModule() {
  const profiles = useProfiles();
  const currentUser = useCurrentUser();
  const isMobile = useIsMobile();
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('accessible');
  const [fixtureFilter, setFixtureFilter] = useState<FixtureFilter>('live');
  const [reassigning, setReassigning] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showMobileInfo, setShowMobileInfo] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  /* ── Fetch conversations ── */
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (!error && data) {
      const mapped = (data as unknown as Conversation[]).filter(c => c.contact);
      setConversations(mapped);
      if (mapped.length > 0 && !selectedConvId) {
        setSelectedConvId(mapped[0].id);
      }
    }
    setLoading(false);
  }, [selectedConvId]);

  /* ── Fetch messages ── */
  const fetchMessages = useCallback(async (convId: string) => {
    setMsgLoading(true);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (!error && data) setMessages(data as Message[]);
    setMsgLoading(false);
    setTimeout(scrollToBottom, 100);
  }, []);

  /* ── Initial load ── */
  useEffect(() => { fetchConversations(); }, []);

  /* ── Fetch pipeline stages once ── */
  useEffect(() => {
    supabase.from('pipeline_stages').select('id, name, color, stage_order').order('stage_order').then(({ data }) => {
      if (data) setStages(data as Stage[]);
    });
  }, []);

  /* ── Update contact (from inline editor) ── */
  const handleUpdateContact = useCallback(async (contactId: string, patch: Partial<Contact>) => {
    const conv = conversations.find(c => c.contact_id === contactId);
    const before = conv?.contact;
    if (!before) return { ok: false, error: 'Contact not found' };

    // Optimistic
    setConversations(prev => prev.map(c =>
      c.contact_id === contactId ? { ...c, contact: { ...c.contact, ...patch } } : c
    ));

    const { error } = await supabase.from('contacts').update(patch).eq('id', contactId);
    if (error) {
      // rollback
      setConversations(prev => prev.map(c =>
        c.contact_id === contactId ? { ...c, contact: before } : c
      ));
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return { ok: false, error: error.message };
    }

    // Activity log — stage change
    if (patch.stage_id !== undefined && patch.stage_id !== before.stage_id) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('contact_activity').insert({
          contact_id: contactId,
          performed_by: user.id,
          type: 'stage_changed',
          metadata: {
            from_stage: stages.find(s => s.id === before.stage_id)?.name || 'Unassigned',
            to_stage: stages.find(s => s.id === patch.stage_id)?.name || 'Unassigned',
            from_stage_id: before.stage_id,
            to_stage_id: patch.stage_id,
            source: 'inbox',
          },
        });
      }
    }

    toast({ title: 'Contact updated' });
    return { ok: true };
  }, [conversations, stages]);


  /* ── Load messages on selection ── */
  useEffect(() => {
    if (selectedConvId) {
      fetchMessages(selectedConvId);
      // Reset unread count when opening a conversation
      supabase.from('conversations').update({ unread_count: 0 }).eq('id', selectedConvId).then(() => {
        setConversations(prev => prev.map(c =>
          c.id === selectedConvId ? { ...c, unread_count: 0 } : c
        ));
      });
    } else {
      setMessages([]);
    }
  }, [selectedConvId, fetchMessages]);

  /* ── Realtime: new messages ── */
  useEffect(() => {
    const channel = supabase
      .channel('inbox-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as Message;
          if (newMsg.conversation_id === selectedConvId) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, { ...newMsg, status_raw: newMsg.status_raw ?? null, error: newMsg.error ?? null }];
            });
            setTimeout(scrollToBottom, 100);
          }
          setConversations(prev =>
            prev.map(c =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message: newMsg.content?.slice(0, 200) || '',
                    last_message_at: newMsg.created_at,
                    unread_count: newMsg.conversation_id === selectedConvId
                      ? c.unread_count
                      : c.unread_count + 1,
                  }
                : c
            ).sort((a, b) => {
              const aT = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const bT = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return bT - aT;
            })
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const updated = payload.new as Message;
          // Update message status in place (delivery receipts)
          setMessages(prev =>
            prev.map(m => m.id === updated.id
              ? { ...m, status: updated.status, status_raw: updated.status_raw ?? null, error: updated.error ?? null }
              : m
            )
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedConvId, fetchConversations]);

  /* ── Send message via edge function ── */
  const sendMessage = async () => {
    if (!inputText.trim() || !selectedConvId || sending) return;
    const content = inputText.trim();
    setSending(true);
    setInputText('');

    // Optimistic: add message immediately
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: selectedConvId,
      content,
      is_outbound: true,
      message_type: 'text',
      status: 'queued',
      status_raw: 'queued',
      error: null,
      created_at: new Date().toISOString(),
      sent_by: currentUser?.id ?? null,
    };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(scrollToBottom, 50);

    // Update conversation list optimistically
    setConversations(prev =>
      prev.map(c =>
        c.id === selectedConvId
          ? { ...c, last_message: content.slice(0, 200), last_message_at: optimistic.created_at }
          : c
      )
    );

    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { conversation_id: selectedConvId, content, message_type: 'text' },
    });

    if (error || !data?.success) {
      // Check for template_required (24h window expired)
      if (data?.error === 'template_required' || data?.code === 'TEMPLATE_REQUIRED') {
        setTemplateModalOpen(true);
      }
      // Rollback optimistic message
      setMessages(prev => prev.filter(m => m.id !== tempId));

      // Build descriptive error with hint if available
      const errorTitle = data?.code ? `Send failed [${data.code}]` : 'Failed to send message';
      const errorDesc = [data?.message, data?.hint].filter(Boolean).join(' — ') || error?.message || 'Unknown error';

      toast({
        title: errorTitle,
        description: errorDesc,
        variant: 'destructive',
      });
    } else {
      // Replace temp with real message (realtime might also push it)
      const real = data.message;
      setMessages(prev =>
        prev.map(m => m.id === tempId ? { ...real, status_raw: real.status_raw ?? null, error: real.error ?? null } : m)
          .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
      );
    }
    setSending(false);
  };

  /* ── Reassign contact ── */
  const handleReassign = useCallback(async (contactId: string, newAssignedTo: string | null) => {
    if (!currentUser) return;
    const conv = conversations.find(c => c.contact_id === contactId);
    const oldAssignedTo = conv?.contact?.assigned_to ?? null;
    if (oldAssignedTo === newAssignedTo) return;

    setReassigning(true);
    // Optimistic
    setConversations(prev => prev.map(c =>
      c.contact_id === contactId
        ? { ...c, contact: { ...c.contact, assigned_to: newAssignedTo } }
        : c
    ));

    const { error } = await supabase
      .from('contacts')
      .update({ assigned_to: newAssignedTo })
      .eq('id', contactId);

    if (error) {
      // Rollback
      setConversations(prev => prev.map(c =>
        c.contact_id === contactId
          ? { ...c, contact: { ...c.contact, assigned_to: oldAssignedTo } }
          : c
      ));
      toast({ title: 'Reassignment failed', description: error.message, variant: 'destructive' });
    } else {
      await supabase.from('contact_activity').insert({
        contact_id: contactId,
        type: 'conversation_reassigned',
        performed_by: currentUser.id,
        metadata: { from: oldAssignedTo, to: newAssignedTo },
      });
      toast({ title: 'Contact reassigned', description: `Assigned to ${profileLabel(profiles, newAssignedTo)}` });
    }
    setReassigning(false);
  }, [currentUser, conversations, profiles]);

  /* ── Filtering ── */
  const filtered = conversations.filter(c => {
    const matchSearch = c.contact?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contact?.phone?.includes(searchQuery);
    if (!matchSearch) return false;
    // Test-fixture isolation (Norah Incident closure 2026-05-02): default to LIVE only.
    const isFixture = isTestFixtureContact(c.contact);
    if (fixtureFilter === 'live' && isFixture) return false;
    if (fixtureFilter === 'test' && !isFixture) return false;
    if (inboxFilter === 'mine') return c.contact?.assigned_to === currentUser?.id;
    if (inboxFilter === 'unassigned') return !c.contact?.assigned_to;
    return true;
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);
  const selected = conversations.find(c => c.id === selectedConvId);

  // Mobile: show list or chat, not both
  const showMobileChat = isMobile && selectedConvId;

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* ── Conversation List (hidden on mobile when chat is open) ── */}
        <div className={cn('w-full md:w-80 shrink-0 border-r border-border flex flex-col bg-card/30', showMobileChat && 'hidden')}>
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-foreground">Inbox</h2>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block" />
                <span>{totalUnread} unread</span>
              </div>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-secondary/60 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="flex gap-1 mt-2">
              {(['accessible', 'mine', 'unassigned'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setInboxFilter(f)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors capitalize',
                    inboxFilter === f
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'text-muted-foreground border-border hover:text-foreground hover:bg-secondary/60'
                  )}
                >
                  {f === 'accessible' ? 'All' : f === 'mine' ? 'My Leads' : 'Unassigned'}
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-2 items-center">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground mr-1">View:</span>
              {(['live', 'test', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFixtureFilter(f)}
                  title={f === 'live' ? 'Real customer threads only (default)' : f === 'test' ? 'QA / Test fixtures only' : 'Show everything'}
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors capitalize',
                    fixtureFilter === f
                      ? (f === 'test' ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                         : 'bg-primary/15 text-primary border-primary/30')
                      : 'text-muted-foreground border-border hover:text-foreground hover:bg-secondary/60'
                  )}
                >
                  {f === 'live' ? 'Live' : f === 'test' ? 'QA/Test' : 'All'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
                <MessageSquare size={20} />
                <span>No conversations</span>
              </div>
            ) : (
              filtered.map(conv => (
                <ConvListItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === selectedConvId}
                  onClick={() => setSelectedConvId(conv.id)}
                  profiles={profiles}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Chat Thread (hidden on mobile when list is showing) ── */}
        <div className={cn('flex-1 flex flex-col min-w-0', isMobile && !showMobileChat && 'hidden')}>
          {selected ? (
            <>
              {/* Header */}
              <div className="px-3 md:px-4 py-2.5 border-b border-border bg-card/20 space-y-2">
                {/* Row 1: identity + actions */}
                <div className="flex items-center gap-2 min-w-0">
                  {isMobile && (
                    <button onClick={() => setSelectedConvId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0">
                      <ArrowLeft size={18} />
                    </button>
                  )}
                  <ContactAvatar name={selected.contact?.name || '?'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground truncate">{selected.contact?.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{displayPhone(selected.contact?.phone || '')}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <IconBtn
                      icon={Phone}
                      title="Call"
                      onClick={() => {
                        const phone = selected.contact?.phone;
                        if (phone) window.open(`tel:${phone}`, '_blank');
                        else toast({ title: 'No phone number', variant: 'destructive' });
                      }}
                    />
                    {!isMobile && (
                      <IconBtn
                        icon={Video}
                        title="Open in WhatsApp"
                        onClick={() => {
                          const phone = selected.contact?.phone;
                          if (phone) window.open(`https://wa.me/${phone}?text=`, '_blank');
                          else toast({ title: 'No phone number', variant: 'destructive' });
                        }}
                      />
                    )}
                    <button
                      onClick={async () => {
                        if (!selectedConvId || aiLoading) return;
                        setAiLoading(true);
                        try {
                          const { data, error } = await supabase.functions.invoke('send-message', {
                            body: {
                              conversation_id: selectedConvId,
                              content: `[AI suggested reply based on context]\n\nPlease follow up with ${selected.contact?.name} regarding their interest.`,
                              message_type: 'ai',
                            },
                          });
                          if (error) throw error;
                          toast({ title: 'AI reply sent' });
                          fetchMessages(selectedConvId);
                        } catch (e: any) {
                          toast({ title: 'AI Reply failed', description: e.message, variant: 'destructive' });
                        } finally {
                          setAiLoading(false);
                        }
                      }}
                      disabled={aiLoading}
                      title="AI Reply"
                      className={cn(
                        'flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium vanto-gradient text-primary-foreground hover:opacity-90 shrink-0',
                        aiLoading && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
                      {!isMobile && <span>AI Reply</span>}
                    </button>
                    {!isMobile && (
                      <button
                        onClick={() => { setShowCopilot(!showCopilot); if (!showCopilot) setShowInfo(false); }}
                        className={cn(
                          'p-1.5 rounded-lg transition-colors',
                          showCopilot ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                        )}
                        title="Zazi Copilot"
                      >
                        <Brain size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isMobile) {
                          setShowMobileInfo(true);
                        } else {
                          setShowInfo(!showInfo);
                          if (!showInfo) setShowCopilot(false);
                        }
                      }}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors',
                        (showInfo && !isMobile) ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                      )}
                      title="Contact details"
                    >
                      <Info size={16} />
                    </button>
                  </div>
                </div>

                {/* Row 2: chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selected.contact?.temperature && (
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[selected.contact.temperature])}>
                      {selected.contact.temperature.toUpperCase()}
                    </span>
                  )}
                  {selected.contact?.lead_type && (
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', leadTypeBg[selected.contact.lead_type])}>
                      {leadTypeLabels[selected.contact.lead_type]}
                    </span>
                  )}
                  {(() => {
                    const ws = getWindowState(selected.last_inbound_at);
                    return (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded text-[9px] font-semibold border cursor-help',
                              ws.open
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            )}
                          >
                            {ws.open ? `🟢 ${ws.hoursLeft}h left` : ws.never ? '🔒 Never replied' : '🔒 Closed'}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          {ws.open ? (
                            <p className="text-xs">You can send free-form messages for the next {ws.hoursLeft} hour(s). After that, only pre-approved Template messages can be sent until the contact replies.</p>
                          ) : (
                            <p className="text-xs">WhatsApp 24-hour reply window has expired. Free-form messages will be rejected (TWILIO_63016). Wait for the contact to reply, or send an approved Template message.</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })()}
                  <div className="ml-auto">
                    <AssignmentControl
                      assignedTo={selected.contact?.assigned_to ?? null}
                      profiles={profiles}
                      isAdmin={!!isAdmin}
                      disabled={reassigning}
                      onChange={val => handleReassign(selected.contact_id, val)}
                    />
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgLoading ? (
                  <div className="flex items-center justify-center h-20 gap-2 text-muted-foreground text-sm">
                    <Loader2 size={14} className="animate-spin" /> Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
                    <MessageSquare size={24} className="opacity-40" />
                    <span>No messages yet — start the conversation</span>
                  </div>
                ) : (
                  messages.map(msg => {
                    const isFailed = msg.is_outbound && (msg.status === 'failed' || msg.status_raw === 'failed' || msg.status_raw === 'undelivered');
                    const isQueued = msg.is_outbound && !isFailed && (msg.status === 'queued' || msg.status_raw === 'queued');
                    // Parse error code from stored error string like "[TWILIO_63007] ..."
                    const errorCode = msg.error?.match(/\[([A-Z_0-9]+)\]/)?.[1] || '';
                    const errorMessage = msg.error?.replace(/\[[A-Z_0-9]+\]\s*/, '') || msg.error || 'Delivery failed';
                    // Classify error category for UI
                    const isMetaBlock = errorCode.startsWith('META_');
                    const isPolicy = errorCode === 'TEMPLATE_REQUIRED' || errorCode === 'META_POLICY_BLOCK';
                    const errorCategory = isMetaBlock ? '⚠️ Meta/Admin' : isPolicy ? '📋 Policy' : errorCode.startsWith('TWILIO_') ? '🔧 Transport' : errorCode.startsWith('MISSING_') ? '⚙️ Config' : '';

                    return (
                    <div key={msg.id} className={cn('flex', msg.is_outbound ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[70%] px-3.5 py-2.5 text-sm', msg.is_outbound ? 'message-bubble-out' : 'message-bubble-in')}>
                        {msg.message_type === 'ai' && (
                          <div className="flex items-center gap-1 mb-1">
                            <Bot size={10} className="text-primary" />
                            <span className="text-[10px] text-primary font-semibold">AI Response</span>
                          </div>
                        )}
                        <p className="text-foreground whitespace-pre-wrap">{msg.content}</p>
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isFailed && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-0.5 text-[10px] text-destructive cursor-help">
                                  <AlertTriangle size={10} /> {errorCode || 'Not delivered'}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs">
                                <div className="space-y-1">
                                  {errorCategory && <p className="text-[10px] font-semibold text-amber-400">{errorCategory}</p>}
                                  {errorCode && <p className="font-mono text-[10px] text-destructive">{errorCode}</p>}
                                  <p className="text-xs">{errorMessage}</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {isQueued && <span className="text-[10px] text-muted-foreground"><Loader2 size={10} className="animate-spin inline" /></span>}
                          {!isFailed && !isQueued && msg.is_outbound && msg.status === 'read' && <span className="text-[10px] text-primary">✓✓</span>}
                          {!isFailed && !isQueued && msg.is_outbound && msg.status === 'delivered' && <span className="text-[10px] text-muted-foreground">✓✓</span>}
                          {!isFailed && !isQueued && msg.is_outbound && msg.status === 'sent' && <span className="text-[10px] text-muted-foreground">✓</span>}
                        </div>
                        {isFailed && (
                          (() => {
                            const nonRetryable = NON_RETRYABLE_CODES.has(errorCode);
                            if (nonRetryable) {
                              return (
                                <div className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-400">
                                  <AlertTriangle size={10} />
                                  <span>{errorCode === 'TWILIO_63016' ? '24-hour reply window expired — Retry won\'t work. Wait for the contact to reply, or send a Template.' : 'Cannot retry — requires a Template message.'}</span>
                                </div>
                              );
                            }
                            return (
                              <button
                                onClick={async () => {
                                  setSending(true);
                                  const { data, error } = await supabase.functions.invoke('send-message', {
                                    body: { conversation_id: msg.conversation_id, content: msg.content, message_type: msg.message_type },
                                  });
                                  if (error || !data?.success) {
                                    const code = data?.code || '';
                                    const friendly = code === 'TWILIO_63016'
                                      ? 'WhatsApp 24-hour window has closed. Free-form messages are blocked until the contact replies.'
                                      : data?.hint || data?.message || error?.message || 'Delivery failed';
                                    toast({ title: 'Retry failed', description: friendly, variant: 'destructive' });
                                  } else {
                                    toast({ title: 'Message resent' });
                                    fetchMessages(msg.conversation_id);
                                  }
                                  setSending(false);
                                }}
                                disabled={sending}
                                className="flex items-center gap-1 mt-1.5 text-[10px] text-primary hover:underline disabled:opacity-50"
                              >
                                <RotateCcw size={10} /> Retry
                              </button>
                            );
                          })()
                        )}
                      </div>
                    </div>
                    );
                  }))
                }
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-3 border-t border-border bg-card/20 space-y-2">
                <DictateMessage value={inputText} onChange={setInputText} size="compact" />
                <div className="flex items-end gap-2">
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-2 shrink-0">
                    <Paperclip size={18} />
                  </button>
                  <div className="flex-1 relative">
                    <textarea
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Type a message..."
                      rows={1}
                      disabled={sending}
                      className="w-full bg-secondary/60 border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors resize-none disabled:opacity-50"
                    />
                  </div>
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-2 shrink-0">
                    <Smile size={18} />
                  </button>
                  <button
                    onClick={sendMessage}
                    disabled={sending || !inputText.trim()}
                    className={cn(
                      'p-2.5 rounded-xl vanto-gradient text-primary-foreground hover:opacity-90 transition-opacity shrink-0',
                      (sending || !inputText.trim()) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <MessageSquare size={32} className="text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">Select a conversation to start chatting</p>
            </div>
          )}
        </div>

        {/* ── Contact Info Panel (desktop) ── */}
        {selected?.contact && showInfo && !isMobile && (
          <div className="w-80 shrink-0 border-l border-border overflow-y-auto bg-card/30">
            <ContactInfoPanel
              contact={selected.contact}
              profiles={profiles}
              stages={stages}
              isAdmin={!!isAdmin}
              reassigning={reassigning}
              onReassign={val => handleReassign(selected.contact_id, val)}
              onSave={(patch) => handleUpdateContact(selected.contact_id, patch)}
            />
          </div>
        )}

        {/* ── Contact Info Panel (mobile slide-over) ── */}
        {selected?.contact && isMobile && showMobileInfo && (
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setShowMobileInfo(false)}>
            <div
              className="absolute right-0 top-0 bottom-0 w-[92%] max-w-sm bg-background border-l border-border overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 border-b border-border sticky top-0 bg-background z-10">
                <p className="text-sm font-semibold text-foreground">Contact Details</p>
                <button onClick={() => setShowMobileInfo(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                  <X size={18} />
                </button>
              </div>
              <ContactInfoPanel
                contact={selected.contact}
                profiles={profiles}
                stages={stages}
                isAdmin={!!isAdmin}
                reassigning={reassigning}
                onReassign={val => handleReassign(selected.contact_id, val)}
                onSave={(patch) => handleUpdateContact(selected.contact_id, patch)}
              />
            </div>
          </div>
        )}

        {/* ── Zazi Copilot Panel (hidden on mobile) ── */}
        {selected && showCopilot && !isMobile && (
          <div className="w-80 shrink-0 border-l border-border overflow-y-auto bg-card/30">
            <CopilotSidebar
              conversationId={selectedConvId}
              contactName={selected.contact?.name || 'Contact'}
              onInsertDraft={(text) => setInputText(text)}
              onSendDraft={async (text) => {
                if (!selectedConvId || sending) return;
                setSending(true);
                const tempId = `temp-${Date.now()}`;
                const optimistic: Message = {
                  id: tempId, conversation_id: selectedConvId, content: text,
                  is_outbound: true, message_type: 'text', status: 'queued',
                  status_raw: 'queued', error: null, created_at: new Date().toISOString(),
                  sent_by: currentUser?.id ?? null,
                };
                setMessages(prev => [...prev, optimistic]);
                const { data, error } = await supabase.functions.invoke('send-message', {
                  body: { conversation_id: selectedConvId, content: text, message_type: 'text' },
                });
                if (error || !data?.success) {
                  setMessages(prev => prev.filter(m => m.id !== tempId));
                  toast({ title: 'Send failed', description: data?.message || error?.message, variant: 'destructive' });
                } else {
                  const real = data.message;
                  setMessages(prev => prev.map(m => m.id === tempId ? { ...real, status_raw: real.status_raw ?? null, error: real.error ?? null } : m)
                    .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i));
                }
                setSending(false);
              }}
            />
          </div>
        )}


        <Dialog open={templateModalOpen} onOpenChange={setTemplateModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" />
                24-Hour Window Expired
              </DialogTitle>
              <DialogDescription>
                WhatsApp requires that freeform messages can only be sent within 24 hours of the customer's last message. 
                To re-engage this contact, you must use a pre-approved message template.
              </DialogDescription>
            </DialogHeader>
            <div className="p-3 rounded-lg bg-secondary/60 border border-border text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">How to proceed:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to your Twilio Console → Messaging → Content Templates</li>
                <li>Select or create an approved template</li>
                <li>Send the template via Twilio Console or API</li>
                <li>Once the customer replies, you can send freeform messages again</li>
              </ol>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTemplateModalOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/* ────────────────────────────────────────────────────────────────────────────── */
/* Sub-components                                                                */
/* ────────────────────────────────────────────────────────────────────────────── */

/* ── Assignment Control (dropdown for admin, badge for agent) ── */
function AssignmentControl({
  assignedTo, profiles, isAdmin, disabled, onChange,
}: {
  assignedTo: string | null;
  profiles: ProfileOption[];
  isAdmin: boolean;
  disabled: boolean;
  onChange: (val: string | null) => void;
}) {
  const label = profileLabel(profiles, assignedTo);

  // All authenticated users can reassign (RLS handles permissions)

  return (
    <div className="relative">
      <select
        value={assignedTo ?? ''}
        disabled={disabled}
        onChange={e => onChange(e.target.value || null)}
        className={cn(
          'appearance-none bg-secondary/60 border border-border rounded-lg pl-2 pr-6 py-1 text-[11px] font-medium text-foreground outline-none focus:border-primary/50 transition-colors cursor-pointer',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <option value="">Unassigned</option>
        {profiles.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      {disabled && <Loader2 size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
    </div>
  );
}

/* ── Conversation List Item ── */
function ConvListItem({ conv, active, onClick, profiles }: {
  conv: Conversation; active: boolean; onClick: () => void;
  profiles: ProfileOption[];
}) {
  const assignedName = profileLabel(profiles, conv.contact?.assigned_to ?? null);
  const assignedProfile = profiles.find(p => p.id === conv.contact?.assigned_to);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border/50',
        active ? 'bg-primary/8 border-l-2 border-l-primary' : 'hover:bg-secondary/30'
      )}
    >
      <div className="relative shrink-0">
        <ContactAvatar name={conv.contact?.name || '?'} size="sm" />
        {conv.unread_count > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full vanto-gradient text-[9px] font-bold text-primary-foreground flex items-center justify-center">
            {conv.unread_count}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-medium text-foreground truncate">{conv.contact?.name || 'Unknown'}</span>
          <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{formatTime(conv.last_message_at)}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{conv.last_message || 'No messages yet'}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {conv.contact?.temperature && (
            <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[conv.contact.temperature])}>
              {conv.contact.temperature.toUpperCase()}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-secondary border border-border text-muted-foreground truncate max-w-[100px]">
                {assignedProfile ? (
                  <MiniAvatar name={assignedProfile.label} />
                ) : (
                  <UserCircle size={10} className="shrink-0 text-muted-foreground/60" />
                )}
                {assignedName}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{assignedProfile ? `Assigned to ${assignedProfile.label}` : 'Unassigned'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </button>
  );
}

/* ── Mini avatar circle ── */
function MiniAvatar({ name }: { name: string }) {
  const colors = ['bg-primary', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500'];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <span className={cn('w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0', colors[idx])}>
      {name[0]}
    </span>
  );
}

/* ── Contact Avatar ── */
function ContactAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const colors = ['from-primary to-teal-600', 'from-blue-500 to-cyan-600', 'from-violet-500 to-purple-600', 'from-amber-500 to-orange-600'];
  const colorIdx = name.charCodeAt(0) % colors.length;
  const s = size === 'sm' ? 'w-9 h-9 text-sm' : 'w-10 h-10 text-sm';
  return (
    <div className={cn('rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white shrink-0', s, colors[colorIdx])}>
      {name[0]}
    </div>
  );
}

/* ── Action Button ── */
function IconBtn({ icon: Icon, title, onClick, disabled }: { icon: React.ElementType; title?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <Icon size={16} />
    </button>
  );
}

function ActionBtn({ icon: Icon, label, primary, onClick, disabled }: { icon: React.ElementType; label?: string; primary?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
        primary ? 'vanto-gradient text-primary-foreground hover:opacity-90' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && !primary && 'cursor-pointer',
      )}
    >
      <Icon size={15} />
      {label && <span>{label}</span>}
    </button>
  );
}

/* ── Contact Info Panel ── */
function ContactInfoPanel({ contact, profiles, stages, isAdmin, reassigning, onReassign, onSave }: {
  contact: Contact; profiles: ProfileOption[]; stages: Stage[]; isAdmin: boolean;
  reassigning: boolean; onReassign: (val: string | null) => void;
  onSave: (patch: Partial<Contact>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: contact.name,
    email: contact.email ?? '',
    lead_type: contact.lead_type,
    temperature: contact.temperature,
    interest: contact.interest,
    stage_id: contact.stage_id ?? '',
    tags: (contact.tags ?? []).join(', '),
    notes: contact.notes ?? '',
  });

  useEffect(() => {
    setForm({
      name: contact.name,
      email: contact.email ?? '',
      lead_type: contact.lead_type,
      temperature: contact.temperature,
      interest: contact.interest,
      stage_id: contact.stage_id ?? '',
      tags: (contact.tags ?? []).join(', '),
      notes: contact.notes ?? '',
    });
    setEditing(false);
  }, [contact.id]);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const patch: Partial<Contact> = {
      name: form.name.trim() || contact.name,
      email: form.email.trim() || null,
      lead_type: form.lead_type,
      temperature: form.temperature,
      interest: form.interest,
      stage_id: form.stage_id || null,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      notes: form.notes.trim() || null,
    };
    const res = await onSave(patch);
    setSaving(false);
    if (res.ok) setEditing(false);
  };

  const currentStage = stages.find(s => s.id === contact.stage_id);

  return (
    <div className="p-4 space-y-4">
      <div className="text-center pt-1">
        <div className="w-14 h-14 rounded-full vanto-gradient flex items-center justify-center text-xl font-bold text-primary-foreground mx-auto mb-2">
          {contact.name[0]}
        </div>
        <h3 className="font-semibold text-foreground text-sm">{contact.name}</h3>
        <p className="text-xs text-muted-foreground">{displayPhone(contact.phone)}</p>
      </div>

      {!editing ? (
        <button
          onClick={() => setEditing(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 text-xs font-medium transition-colors"
        >
          <Pencil size={13} /> Edit & Add to CRM
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>
        </div>
      )}

      {/* CRM Pipeline */}
      <div className="vanto-card p-3 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">CRM Pipeline Stage</p>
        {editing ? (
          <select
            value={form.stage_id}
            onChange={e => set('stage_id', e.target.value)}
            className="w-full bg-secondary/60 border border-border rounded-lg px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          >
            <option value="">— Unassigned —</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ background: currentStage?.color || 'hsl(var(--muted-foreground))' }} />
            <span className="text-foreground font-medium">{currentStage?.name || 'Not in pipeline'}</span>
          </div>
        )}
      </div>

      {/* Assignment */}
      <div className="vanto-card p-3 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Assignment</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Assigned To</span>
          <div className="relative">
            <select
              value={contact.assigned_to ?? ''}
              disabled={reassigning}
              onChange={e => onReassign(e.target.value || null)}
              className={cn(
                'appearance-none bg-secondary/60 border border-border rounded-lg pl-2 pr-6 py-1 text-xs font-medium text-foreground outline-none focus:border-primary/50',
                reassigning && 'opacity-50 cursor-not-allowed'
              )}
            >
              <option value="">Unassigned</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {reassigning && <Loader2 size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Lead details */}
      <div className="vanto-card p-3 space-y-2.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Lead Details</p>

        <EditableField label="Name" editing={editing}
          render={() => <span className="text-foreground font-medium">{contact.name}</span>}
          input={<input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />}
        />
        <EditableField label="Email" editing={editing}
          render={() => <span className="text-foreground font-medium truncate">{contact.email || 'Not set'}</span>}
          input={<input value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" className={inputCls} />}
        />
        <EditableField label="Lead Type" editing={editing}
          render={() => (
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border', leadTypeBg[contact.lead_type])}>
              {leadTypeLabels[contact.lead_type]}
            </span>
          )}
          input={
            <select value={form.lead_type} onChange={e => set('lead_type', e.target.value as LeadType)} className={inputCls}>
              {LEAD_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
            </select>
          }
        />
        <EditableField label="Temperature" editing={editing}
          render={() => (
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold border', temperatureBg[contact.temperature])}>
              {contact.temperature.toUpperCase()}
            </span>
          )}
          input={
            <select value={form.temperature} onChange={e => set('temperature', e.target.value as LeadTemperature)} className={inputCls}>
              <option value="cold">Cold</option>
              <option value="warm">Warm</option>
              <option value="hot">Hot</option>
            </select>
          }
        />
        <EditableField label="Interest" editing={editing}
          render={() => <span className="text-foreground font-medium capitalize">{contact.interest}</span>}
          input={
            <select value={form.interest} onChange={e => set('interest', e.target.value as 'high' | 'medium' | 'low')} className={inputCls}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          }
        />
      </div>

      {/* Tags */}
      <div className="vanto-card p-3 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tags</p>
        {editing ? (
          <input
            value={form.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="comma, separated, tags"
            className={inputCls}
          />
        ) : contact.tags && contact.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {contact.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-md text-[10px] bg-secondary text-muted-foreground border border-border">{tag}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No tags</p>
        )}
      </div>

      {/* Notes */}
      <div className="vanto-card p-3 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</p>
        {editing ? (
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={4}
            placeholder="Add notes about this prospect..."
            className={cn(inputCls, 'resize-y')}
          />
        ) : (
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{contact.notes || <span className="italic">No notes</span>}</p>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-secondary/60 border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50';

function EditableField({ label, editing, render, input }: { label: string; editing: boolean; render: () => React.ReactNode; input: React.ReactNode }) {
  return (
    <div className={editing ? 'space-y-1' : 'flex items-center justify-between gap-2 text-xs'}>
      <span className={cn('text-muted-foreground', editing ? 'text-[10px] font-medium block' : '')}>{label}</span>
      {editing ? input : <div className="text-right min-w-0 truncate">{render()}</div>}
    </div>
  );
}

/* ── Utility ── */
function formatTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
