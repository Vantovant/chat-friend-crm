import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { temperatureBg, type LeadTemperature } from '@/lib/vanto-data';
import { Search, Phone, Video, MoreVertical, Send, Bot, Paperclip, Smile, Info, Loader2 } from 'lucide-react';

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
  content: string;
  is_outbound: boolean;
  message_type: string;
  status: string | null;
  created_at: string;
};

export function InboxModule() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (selectedConvId) fetchMessages(selectedConvId);
  }, [selectedConvId]);

  const fetchConversations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .order('last_message_at', { ascending: false })
      .limit(100);
    if (!error && data) {
      setConversations(data as unknown as Conversation[]);
      if (data.length > 0 && !selectedConvId) setSelectedConvId(data[0].id);
    }
    setLoading(false);
  };

  const fetchMessages = async (convId: string) => {
    setMsgLoading(true);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (!error && data) setMessages(data as Message[]);
    setMsgLoading(false);
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !selectedConvId) return;
    const { error } = await supabase.from('messages').insert({
      conversation_id: selectedConvId,
      content: inputText.trim(),
      is_outbound: true,
      message_type: 'text',
    });
    if (!error) {
      setInputText('');
      fetchMessages(selectedConvId);
    }
  };

  const filtered = conversations.filter(c =>
    c.contact?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contact?.phone?.includes(searchQuery)
  );

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);
  const selected = conversations.find(c => c.id === selectedConvId);

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="flex h-full">
      {/* Chat List */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col bg-card/30">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground">Inbox</h2>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block"></span>
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
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No conversations yet</div>
          ) : (
            filtered.map(conv => (
              <ConvListItem
                key={conv.id}
                conv={conv}
                active={conv.id === selectedConvId}
                onClick={() => setSelectedConvId(conv.id)}
                formatTime={formatTime}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/20">
              <div className="flex items-center gap-3">
                <ContactAvatar name={selected.contact?.name || '?'} />
                <div>
                  <p className="font-semibold text-sm text-foreground">{selected.contact?.name}</p>
                  <p className="text-xs text-muted-foreground">{selected.contact?.phone}</p>
                </div>
                {selected.contact?.temperature && (
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', temperatureBg[selected.contact.temperature as LeadTemperature])}>
                    {selected.contact.temperature.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ActionBtn icon={Phone} />
                <ActionBtn icon={Video} />
                <ActionBtn icon={Bot} label="AI Reply" primary />
                <button onClick={() => setShowInfo(!showInfo)} className={cn('p-2 rounded-lg transition-colors', showInfo ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60')}>
                  <Info size={16} />
                </button>
                <ActionBtn icon={MoreVertical} />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgLoading ? (
                <div className="flex items-center justify-center h-20 gap-2 text-muted-foreground text-sm">
                  <Loader2 size={14} className="animate-spin" /> Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">No messages yet</div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={cn('flex', msg.is_outbound ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[70%] px-3.5 py-2.5 text-sm', msg.is_outbound ? 'message-bubble-out' : 'message-bubble-in')}>
                      {msg.message_type === 'ai' && (
                        <div className="flex items-center gap-1 mb-1">
                          <Bot size={10} className="text-primary" />
                          <span className="text-[10px] text-primary font-semibold">AI Response</span>
                        </div>
                      )}
                      <p className="text-foreground">{msg.content}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[10px] text-muted-foreground">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {msg.is_outbound && msg.status === 'read' && <span className="text-[10px] text-primary">✓✓</span>}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-border bg-card/20">
              <div className="flex items-end gap-2">
                <button className="text-muted-foreground hover:text-foreground transition-colors p-2 shrink-0">
                  <Paperclip size={18} />
                </button>
                <div className="flex-1 relative">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type a message..."
                    rows={1}
                    className="w-full bg-secondary/60 border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors resize-none"
                  />
                </div>
                <button className="text-muted-foreground hover:text-foreground transition-colors p-2 shrink-0">
                  <Smile size={18} />
                </button>
                <button onClick={sendMessage} className="p-2.5 rounded-xl vanto-gradient text-primary-foreground hover:opacity-90 transition-opacity shrink-0">
                  <Send size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Select a conversation</p>
          </div>
        )}
      </div>

      {/* Contact Info Panel */}
      {selected?.contact && showInfo && (
        <div className="w-72 shrink-0 border-l border-border overflow-y-auto bg-card/30">
          <ContactInfoPanel contact={selected.contact} />
        </div>
      )}
    </div>
  );
}

function ConvListItem({ conv, active, onClick, formatTime }: { conv: Conversation; active: boolean; onClick: () => void; formatTime: (s: string | null) => string }) {
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
        {conv.contact?.temperature && (
          <span className={cn('mt-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[conv.contact.temperature as LeadTemperature])}>
            {conv.contact.temperature.toUpperCase()}
          </span>
        )}
      </div>
    </button>
  );
}

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

function ActionBtn({ icon: Icon, label, primary }: { icon: React.ElementType; label?: string; primary?: boolean }) {
  return (
    <button className={cn(
      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
      primary ? 'vanto-gradient text-primary-foreground hover:opacity-90' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
    )}>
      <Icon size={15} />
      {label && <span>{label}</span>}
    </button>
  );
}

function ContactInfoPanel({ contact }: { contact: Contact }) {
  return (
    <div className="p-4 space-y-5">
      <div className="text-center pt-2">
        <div className="w-16 h-16 rounded-full vanto-gradient flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto mb-3">
          {contact.name[0]}
        </div>
        <h3 className="font-semibold text-foreground">{contact.name}</h3>
        <p className="text-xs text-muted-foreground">{contact.phone}</p>
        {contact.temperature && (
          <div className="flex justify-center gap-2 mt-2">
            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', temperatureBg[contact.temperature as LeadTemperature])}>
              {contact.temperature.toUpperCase()}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary border border-border text-muted-foreground capitalize">
              {contact.lead_type}
            </span>
          </div>
        )}
      </div>

      <div className="vanto-card p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contact Info</p>
        <InfoRow label="Email" value={contact.email || 'Not set'} />
        <InfoRow label="Interest" value={contact.interest} />
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
          <p className="text-xs text-muted-foreground">{contact.notes}</p>
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
