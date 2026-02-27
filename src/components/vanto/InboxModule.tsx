import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { temperatureBg, type LeadTemperature } from '@/lib/vanto-data';
import {
  Search, Phone, Video, MoreVertical, Send, Bot, Brain,
  Paperclip, Smile, Info, Loader2, UserCircle, MessageSquare, AlertTriangle, RotateCcw, ArrowLeft,
} from 'lucide-react';
import { displayPhone } from '@/lib/phone-utils';
import { useProfiles, profileLabel, type ProfileOption } from '@/hooks/use-profiles';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CopilotSidebar } from './CopilotSidebar';


/* ── Types ── */
type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  temperature: LeadTemperature;
  lead_type: string;
  interest: string;
  tags: string[] | null;
  notes: string | null;
  assigned_to: string | null;
};

type Conversation = {
  id: string;
  contact_id: string;
  status: string;
  unread_count: number;
  last_message: string | null;
  last_message_at: string | null;
  contact: Contact;
};

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
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('accessible');
  const [reassigning, setReassigning] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);

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
              <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-border bg-card/20">
                <div className="flex items-center gap-2 md:gap-3 min-w-0">
                  {isMobile && (
                    <button onClick={() => setSelectedConvId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0">
                      <ArrowLeft size={18} />
                    </button>
                  )}
                  <ContactAvatar name={selected.contact?.name || '?'} />
                  <div>
                    <p className="font-semibold text-sm text-foreground">{selected.contact?.name}</p>
                    <p className="text-xs text-muted-foreground">{displayPhone(selected.contact?.phone || '')}</p>
                  </div>
                  {selected.contact?.temperature && (
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', temperatureBg[selected.contact.temperature])}>
                      {selected.contact.temperature.toUpperCase()}
                    </span>
                  )}
                  <AssignmentControl
                    assignedTo={selected.contact?.assigned_to ?? null}
                    profiles={profiles}
                    isAdmin={!!isAdmin}
                    disabled={reassigning}
                    onChange={val => handleReassign(selected.contact_id, val)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <ActionBtn
                    icon={Phone}
                    onClick={() => {
                      const phone = selected.contact?.phone;
                      if (phone) window.open(`tel:${phone}`, '_blank');
                      else toast({ title: 'No phone number', variant: 'destructive' });
                    }}
                  />
                  <ActionBtn
                    icon={Video}
                    onClick={() => {
                      const phone = selected.contact?.phone;
                      if (phone) window.open(`https://wa.me/${phone}?text=`, '_blank');
                      else toast({ title: 'No phone number', variant: 'destructive' });
                    }}
                  />
                  <ActionBtn
                    icon={Bot}
                    label="AI Reply"
                    primary
                    disabled={aiLoading}
                    onClick={async () => {
                      if (!selectedConvId || aiLoading) return;
                      setAiLoading(true);
                      try {
                        const lastMsgs = messages.slice(-5).map(m => `${m.is_outbound ? 'Agent' : 'Contact'}: ${m.content}`).join('\n');
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
                  />
                  <button
                    onClick={() => { setShowCopilot(!showCopilot); if (!showCopilot) setShowInfo(false); }}
                    className={cn(
                      'p-2 rounded-lg transition-colors cursor-pointer',
                      showCopilot ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                    )}
                    title="Zazi Copilot"
                  >
                    <Brain size={16} />
                  </button>
                  <button
                    onClick={() => { setShowInfo(!showInfo); if (!showInfo) setShowCopilot(false); }}
                    className={cn(
                      'p-2 rounded-lg transition-colors cursor-pointer',
                      showInfo ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                    )}
                  >
                    <Info size={16} />
                  </button>
                  <ActionBtn
                    icon={MoreVertical}
                    onClick={() => {
                      toast({ title: 'More options coming soon', description: 'Archive, mark as read, etc.' });
                    }}
                  />
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
                          <button
                            onClick={async () => {
                              setSending(true);
                              const { data, error } = await supabase.functions.invoke('send-message', {
                                body: { conversation_id: msg.conversation_id, content: msg.content, message_type: msg.message_type },
                              });
                              if (error || !data?.success) {
                                toast({ title: 'Retry failed', description: data?.hint || data?.message || error?.message, variant: 'destructive' });
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
                        )}
                      </div>
                    </div>
                    );
                  }))
                }
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-border bg-card/20">
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

        {/* ── Contact Info Panel (hidden on mobile) ── */}
        {selected?.contact && showInfo && !isMobile && (
          <div className="w-72 shrink-0 border-l border-border overflow-y-auto bg-card/30">
            <ContactInfoPanel
              contact={selected.contact}
              profiles={profiles}
              isAdmin={!!isAdmin}
              reassigning={reassigning}
              onReassign={val => handleReassign(selected.contact_id, val)}
            />
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
function ContactInfoPanel({ contact, profiles, isAdmin, reassigning, onReassign }: {
  contact: Contact; profiles: ProfileOption[]; isAdmin: boolean;
  reassigning: boolean; onReassign: (val: string | null) => void;
}) {
  return (
    <div className="p-4 space-y-5">
      <div className="text-center pt-2">
        <div className="w-16 h-16 rounded-full vanto-gradient flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto mb-3">
          {contact.name[0]}
        </div>
        <h3 className="font-semibold text-foreground">{contact.name}</h3>
        <p className="text-xs text-muted-foreground">{displayPhone(contact.phone)}</p>
        {contact.temperature && (
          <div className="flex justify-center gap-2 mt-2">
            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', temperatureBg[contact.temperature])}>
              {contact.temperature.toUpperCase()}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary border border-border text-muted-foreground capitalize">
              {contact.lead_type}
            </span>
          </div>
        )}
      </div>

      {/* Assignment section */}
      <div className="vanto-card p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Assignment</p>
        {isAdmin ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Assigned To</span>
            <div className="relative">
              <select
                value={contact.assigned_to ?? ''}
                disabled={reassigning}
                onChange={e => onReassign(e.target.value || null)}
                className={cn(
                  'appearance-none bg-secondary/60 border border-border rounded-lg pl-2 pr-6 py-1 text-xs font-medium text-foreground outline-none focus:border-primary/50 transition-colors cursor-pointer',
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
        ) : (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Assigned To</span>
            <span className="text-foreground font-medium">{profileLabel(profiles, contact.assigned_to)}</span>
          </div>
        )}
      </div>

      <div className="vanto-card p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contact Info</p>
        <InfoRow label="Email" value={contact.email || 'Not set'} />
        <InfoRow label="Interest" value={contact.interest} />
        <InfoRow label="Lead Type" value={contact.lead_type} />
      </div>

      {contact.tags && contact.tags.length > 0 && (
        <div className="vanto-card p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tags</p>
          <div className="flex flex-wrap gap-1">
            {contact.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-md text-xs bg-secondary text-muted-foreground border border-border">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {contact.notes && (
        <div className="vanto-card p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{contact.notes}</p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium capitalize">{value}</span>
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
