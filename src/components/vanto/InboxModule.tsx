import { useState } from 'react';
import { mockContacts, mockMessages, temperatureBg, type Contact } from '@/lib/vanto-data';
import { cn } from '@/lib/utils';
import { Search, Phone, Video, MoreVertical, Send, Bot, Paperclip, Smile, Info, User, Tag, Star } from 'lucide-react';

export function InboxModule() {
  const [selectedId, setSelectedId] = useState<string>('c1');
  const [showInfo, setShowInfo] = useState(true);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = mockContacts.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  );

  const selected = mockContacts.find(c => c.id === selectedId);
  const messages = selectedId ? (mockMessages[selectedId] || []) : [];

  return (
    <div className="flex h-full">
      {/* Chat List */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col bg-card/30">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground">Inbox</h2>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block"></span>
              <span>6 unread</span>
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
          {/* Filter tabs */}
          <div className="flex gap-1 mt-3">
            {['All', 'Hot', 'Warm', 'Cold'].map(f => (
              <button key={f} className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                f === 'All' ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              )}>{f}</button>
            ))}
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map(contact => (
            <ChatListItem
              key={contact.id}
              contact={contact}
              active={contact.id === selectedId}
              onClick={() => setSelectedId(contact.id)}
            />
          ))}
        </div>
      </div>

      {/* Chat Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/20">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ContactAvatar contact={selected} size="md" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-background"></span>
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">{selected.name}</p>
                  <p className="text-xs text-muted-foreground">{selected.phone} · Online</p>
                </div>
                <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', temperatureBg[selected.temperature])}>
                  {selected.temperature.toUpperCase()}
                </span>
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

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="text-center text-xs text-muted-foreground mb-2">Today</div>
              {messages.map(msg => (
                <div key={msg.id} className={cn('flex', msg.isOutbound ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[70%] px-3.5 py-2.5 text-sm', msg.isOutbound ? 'message-bubble-out' : 'message-bubble-in')}>
                    {msg.type === 'ai' && (
                      <div className="flex items-center gap-1 mb-1">
                        <Bot size={10} className="text-primary" />
                        <span className="text-[10px] text-primary font-semibold">AI Response</span>
                      </div>
                    )}
                    <p className="text-foreground">{msg.content}</p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                      {msg.isOutbound && msg.status === 'read' && (
                        <span className="text-[10px] text-primary">✓✓</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {/* Typing indicator */}
              <div className="flex justify-start">
                <div className="message-bubble-in px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border bg-card/20">
              {/* AI suggestion */}
              <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg bg-primary/8 border border-primary/20">
                <Bot size={14} className="text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-primary font-medium mb-0.5">AI Suggestion</p>
                  <p className="text-xs text-muted-foreground truncate">Sure! Our Premium Plan includes unlimited contacts, AI automation, and priority support at $299/mo.</p>
                </div>
                <button className="text-xs text-primary border border-primary/30 rounded px-2 py-0.5 hover:bg-primary/15 transition-colors shrink-0">Use</button>
              </div>
              <div className="flex items-end gap-2">
                <button className="text-muted-foreground hover:text-foreground transition-colors p-2 shrink-0">
                  <Paperclip size={18} />
                </button>
                <div className="flex-1 relative">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    placeholder="Type a message..."
                    rows={1}
                    className="w-full bg-secondary/60 border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors resize-none"
                  />
                </div>
                <button className="text-muted-foreground hover:text-foreground transition-colors p-2 shrink-0">
                  <Smile size={18} />
                </button>
                <button className="p-2.5 rounded-xl vanto-gradient text-primary-foreground hover:opacity-90 transition-opacity shrink-0">
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
      {selected && showInfo && (
        <div className="w-72 shrink-0 border-l border-border overflow-y-auto bg-card/30">
          <ContactInfoPanel contact={selected} />
        </div>
      )}
    </div>
  );
}

function ChatListItem({ contact, active, onClick }: { contact: Contact; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border/50',
        active ? 'bg-primary/8 border-l-2 border-l-primary' : 'hover:bg-secondary/30'
      )}
    >
      <div className="relative shrink-0">
        <ContactAvatar contact={contact} size="sm" />
        {contact.unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full vanto-gradient text-[9px] font-bold text-primary-foreground flex items-center justify-center">
            {contact.unread}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-medium text-foreground truncate">{contact.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{contact.lastMessageTime}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{contact.lastMessage}</p>
        <div className="flex gap-1 mt-1">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[contact.temperature])}>
            {contact.temperature.toUpperCase()}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-secondary/80 text-muted-foreground border border-border">
            {contact.leadType.toUpperCase()}
          </span>
        </div>
      </div>
    </button>
  );
}

function ContactAvatar({ contact, size }: { contact: Contact; size: 'sm' | 'md' }) {
  const colors = ['from-primary to-teal-600', 'from-blue-500 to-cyan-600', 'from-violet-500 to-purple-600', 'from-amber-500 to-orange-600'];
  const colorIdx = contact.name.charCodeAt(0) % colors.length;
  const s = size === 'sm' ? 'w-9 h-9 text-sm' : 'w-10 h-10 text-sm';
  return (
    <div className={cn('rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white shrink-0', s, colors[colorIdx])}>
      {contact.name[0]}
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
      {/* Header */}
      <div className="text-center pt-2">
        <div className="w-16 h-16 rounded-full vanto-gradient flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto mb-3">
          {contact.name[0]}
        </div>
        <h3 className="font-semibold text-foreground">{contact.name}</h3>
        <p className="text-xs text-muted-foreground">{contact.phone}</p>
        <div className="flex justify-center gap-2 mt-2">
          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', temperatureBg[contact.temperature])}>
            {contact.temperature.toUpperCase()}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary border border-border text-muted-foreground">
            {contact.leadType}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="vanto-card p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contact Info</p>
        <InfoRow label="Email" value={contact.email || 'Not set'} />
        <InfoRow label="Stage" value={contact.stage || 'Lead'} />
        <InfoRow label="Assigned" value={contact.assignedTo || 'Unassigned'} />
        <InfoRow label="Interest" value={contact.interest} />
      </div>

      {/* Tags */}
      <div className="vanto-card p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tags</p>
          <button className="text-primary text-xs hover:underline">+ Add</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {contact.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 rounded-md text-xs bg-secondary text-muted-foreground border border-border">{tag}</span>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="vanto-card p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
        <textarea
          defaultValue={contact.notes || 'Add a note...'}
          className="w-full bg-transparent text-xs text-muted-foreground outline-none resize-none"
          rows={3}
        />
      </div>

      {/* Quick actions */}
      <div className="space-y-1.5">
        <button className="w-full py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          Send Message
        </button>
        <button className="w-full py-2 rounded-lg bg-secondary border border-border text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors">
          Move to CRM
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
