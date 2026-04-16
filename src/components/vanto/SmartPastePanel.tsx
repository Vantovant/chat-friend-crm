import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { format, eachDayOfInterval, setHours, setMinutes } from 'date-fns';
import { ClipboardPaste, Sparkles, CalendarIcon, Trash2, Eye, EyeOff, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

type WhatsAppGroup = { id: string; group_name: string; group_jid?: string | null };
type ParsedMessage = { index: number; content: string; label?: string };

type DetectedFormat = 'day-numbered' | 'json-array' | 'json-keyed' | 'line-separated' | 'unknown';

const FORMAT_LABELS: Record<DetectedFormat, string> = {
  'day-numbered': 'DAY-numbered list',
  'json-array': 'JSON array',
  'json-keyed': 'JSON keyed object',
  'line-separated': 'Line-separated messages',
  'unknown': 'Not detected',
};

const FORMAT_HELP: Record<DetectedFormat, string> = {
  'day-numbered': 'Each message starts with "DAY X —" on a new line. Separate messages with blank lines.',
  'json-array': 'A JSON array of strings: ["message 1", "message 2", ...]',
  'json-keyed': 'A JSON object with keys like "monday", "day1": {"monday": "message", ...}',
  'line-separated': 'Each message separated by one or more blank lines.',
  'unknown': 'Paste your content and we\'ll try to detect the format.',
};

function detectFormat(raw: string): DetectedFormat {
  const trimmed = raw.trim();
  if (!trimmed) return 'unknown';

  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return 'json-array';
      if (typeof parsed === 'object') {
        // Check for nested messages property
        if (Array.isArray(parsed.messages)) return 'json-array';
        if (typeof parsed.messages === 'object' && !Array.isArray(parsed.messages)) return 'json-keyed';
        return 'json-keyed';
      }
    } catch { /* not valid JSON */ }
  }

  // Check for DAY X pattern
  if (/DAY\s*\d+/i.test(trimmed)) return 'day-numbered';

  // Fallback: line-separated
  return 'line-separated';
}

function parseMessages(raw: string, format: DetectedFormat): ParsedMessage[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  switch (format) {
    case 'json-array': {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.messages) ? parsed.messages : []);
        return arr.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string, i: number) => ({
          index: i,
          content: s.trim(),
          label: `Message ${i + 1}`,
        }));
      } catch { return []; }
    }
    case 'json-keyed': {
      try {
        const parsed = JSON.parse(trimmed);
        const obj = parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : parsed;
        return Object.entries(obj)
          .filter(([, v]) => typeof v === 'string' && (v as string).trim())
          .map(([key, val], i) => ({
            index: i,
            content: (val as string).trim(),
            label: key.charAt(0).toUpperCase() + key.slice(1),
          }));
      } catch { return []; }
    }
    case 'day-numbered': {
      // Split by "DAY X" pattern
      const parts = trimmed.split(/(?=DAY\s*\d+)/i).filter(s => s.trim());
      return parts.map((part, i) => {
        const match = part.match(/^DAY\s*(\d+)\s*[—–-]?\s*/i);
        return {
          index: i,
          content: part.trim(),
          label: match ? `Day ${match[1]}` : `Message ${i + 1}`,
        };
      });
    }
    case 'line-separated': {
      // Split by double newline
      const parts = trimmed.split(/\n\s*\n/).filter(s => s.trim());
      return parts.map((part, i) => ({
        index: i,
        content: part.trim(),
        label: `Message ${i + 1}`,
      }));
    }
    default:
      return [{ index: 0, content: trimmed, label: 'Message 1' }];
  }
}

const TIME_PRESETS = [
  { id: 'morning', label: '07:00 (Morning)', time: '07:00' },
  { id: 'midday', label: '12:00 (Midday)', time: '12:00' },
  { id: 'evening', label: '17:00 (Evening)', time: '17:00' },
] as const;

interface SmartPastePanelProps {
  groups: WhatsAppGroup[];
  onScheduled: () => void;
}

export function SmartPastePanel({ groups, onScheduled }: SmartPastePanelProps) {
  const [rawInput, setRawInput] = useState('');
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat>('unknown');
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [isParsed, setIsParsed] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  // Scheduling state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [isMultiGroup, setIsMultiGroup] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'sequential' | 'same-time'>('sequential');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [postTime, setPostTime] = useState('07:00');
  const [saving, setSaving] = useState(false);

  const handleParse = () => {
    const fmt = detectFormat(rawInput);
    setDetectedFormat(fmt);
    const parsed = parseMessages(rawInput, fmt);
    setMessages(parsed);
    setIsParsed(true);
    if (parsed.length === 0) {
      toast.error('Could not parse any messages from the input.');
    } else {
      toast.success(`Detected ${FORMAT_LABELS[fmt]} — ${parsed.length} message(s) found`);
    }
  };

  const handleRemoveMessage = (idx: number) => {
    setMessages(prev => prev.filter(m => m.index !== idx).map((m, i) => ({ ...m, index: i })));
  };

  const handleSchedule = async () => {
    const targetGroups = isMultiGroup ? selectedGroups : (selectedGroup ? [selectedGroup] : []);
    if (targetGroups.length === 0) { toast.error('Select at least one group.'); return; }
    if (messages.length === 0) { toast.error('No messages to schedule.'); return; }
    if (!startDate) { toast.error('Pick a start date.'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not authenticated'); return; }

    setSaving(true);
    try {
      const [h, m] = postTime.split(':').map(Number);
      const rows: any[] = [];

      for (const groupName of targetGroups) {
        const gData = groups.find(g => g.group_name === groupName);
        const jid = gData?.group_jid || null;

        if (scheduleMode === 'sequential') {
          // One message per day
          for (let i = 0; i < messages.length; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const scheduledDate = setMinutes(setHours(date, h), m);
            rows.push({
              user_id: user.id,
              target_group_name: groupName,
              target_group_jid: jid,
              message_content: messages[i].content,
              scheduled_at: scheduledDate.toISOString(),
              status: 'pending',
            });
          }
        } else {
          // All messages at same date/time (different use case)
          const scheduledDate = setMinutes(setHours(startDate, h), m);
          for (const msg of messages) {
            rows.push({
              user_id: user.id,
              target_group_name: groupName,
              target_group_jid: jid,
              message_content: msg.content,
              scheduled_at: scheduledDate.toISOString(),
              status: 'pending',
            });
          }
        }
      }

      // Insert in batches
      for (let b = 0; b < rows.length; b += 50) {
        const batch = rows.slice(b, b + 50);
        const { error } = await supabase.from('scheduled_group_posts').insert(batch);
        if (error) { toast.error('Insert failed: ' + error.message); setSaving(false); return; }
      }

      toast.success(`${rows.length} post(s) scheduled across ${targetGroups.length} group(s)!`);
      setRawInput('');
      setMessages([]);
      setIsParsed(false);
      setSelectedGroup('');
      setSelectedGroups([]);
      setStartDate(undefined);
      onScheduled();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardPaste size={18} className="text-primary" />
          Smart Paste — Create Campaign from Content
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Format Guide */}
        <div className="rounded-lg bg-secondary/40 border border-border p-3 space-y-2">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Sparkles size={14} className="text-primary" />
            Supported Formats
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">📋 DAY-numbered</p>
              <p>DAY 1 — Your message here<br/>DAY 2 — Next message…</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">📦 JSON Array</p>
              <p>["Message 1", "Message 2", …]</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">🗂️ JSON Keyed</p>
              <p>{`{"monday": "…", "tuesday": "…"}`}</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">📝 Line-separated</p>
              <p>First message<br/><br/>Second message<br/>(blank line between)</p>
            </div>
          </div>
        </div>

        {/* Paste Area */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Paste Your Content</label>
          <Textarea
            value={rawInput}
            onChange={e => { setRawInput(e.target.value); setIsParsed(false); }}
            placeholder="Paste your campaign content here in any supported format…"
            rows={8}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleParse} disabled={!rawInput.trim()} className="gap-1.5">
            <Sparkles size={14} />
            Parse Content
          </Button>
          {isParsed && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {FORMAT_LABELS[detectedFormat]}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {messages.length} message{messages.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          )}
        </div>

        {/* Parsed Preview */}
        {isParsed && messages.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Parsed Messages</label>
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </Button>
            </div>

            {showPreview && (
              <ScrollArea className="max-h-64 rounded-lg border border-border">
                <div className="p-2 space-y-1.5">
                  {messages.map((msg) => (
                    <div key={msg.index} className="flex items-start gap-2 p-2 rounded bg-secondary/30 hover:bg-secondary/50 group">
                      <GripVertical size={14} className="mt-1 text-muted-foreground/40 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-primary">{msg.label}</p>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{msg.content}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => handleRemoveMessage(msg.index)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Scheduling Options */}
            <div className="space-y-4 pt-2 border-t border-border">
              {/* Multi-group toggle */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border">
                <Switch checked={isMultiGroup} onCheckedChange={(v) => { setIsMultiGroup(v); setSelectedGroup(''); setSelectedGroups([]); }} />
                <div>
                  <p className="text-sm font-medium text-foreground">{isMultiGroup ? 'Multi-Group Broadcast' : 'Single Group'}</p>
                  <p className="text-xs text-muted-foreground">{isMultiGroup ? 'Same messages to multiple groups' : 'Send to one group'}</p>
                </div>
              </div>

              {/* Group selector */}
              {!isMultiGroup ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Target Group</label>
                  <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map(g => (
                        <SelectItem key={g.id} value={g.group_name}>
                          {g.group_name}
                          {g.group_jid && <span className="text-xs text-muted-foreground ml-1">(JID ✓)</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Target Groups <span className="text-muted-foreground font-normal">({selectedGroups.length} selected)</span>
                  </label>
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2 space-y-1">
                    <div className="flex gap-2 mb-2">
                      <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setSelectedGroups(groups.map(g => g.group_name))}>Select All</Button>
                      <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setSelectedGroups([])}>Clear</Button>
                    </div>
                    {groups.map(g => (
                      <label key={g.id} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-secondary/60">
                        <Checkbox
                          checked={selectedGroups.includes(g.group_name)}
                          onCheckedChange={(checked) => {
                            setSelectedGroups(prev => checked ? [...prev, g.group_name] : prev.filter(n => n !== g.group_name));
                          }}
                        />
                        <span className="text-sm text-foreground">{g.group_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Schedule mode */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Schedule Mode</label>
                  <Select value={scheduleMode} onValueChange={(v) => setScheduleMode(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">1 per day (sequential)</SelectItem>
                      <SelectItem value="same-time">All at same time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {scheduleMode === 'sequential' ? 'Start Date' : 'Date'}
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                        <CalendarIcon size={14} className="mr-2" />
                        {startDate ? format(startDate, 'PPP') : 'Pick date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Post Time</label>
                  <Select value={postTime} onValueChange={setPostTime}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_PRESETS.map(p => (
                        <SelectItem key={p.id} value={p.time}>{p.label}</SelectItem>
                      ))}
                      <SelectItem value="custom">Custom time…</SelectItem>
                    </SelectContent>
                  </Select>
                  {postTime === 'custom' && (
                    <Input type="time" value="09:00" onChange={e => setPostTime(e.target.value)} className="mt-1" />
                  )}
                </div>
              </div>

              {scheduleMode === 'sequential' && startDate && messages.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  📅 {messages.length} messages will be posted daily from{' '}
                  <span className="text-foreground font-medium">{format(startDate, 'MMM d')}</span> to{' '}
                  <span className="text-foreground font-medium">
                    {format(new Date(new Date(startDate).setDate(startDate.getDate() + messages.length - 1)), 'MMM d, yyyy')}
                  </span>{' '}
                  at {postTime}
                </p>
              )}

              <Button onClick={handleSchedule} disabled={saving} className="w-full sm:w-auto">
                <ClipboardPaste size={16} />
                {saving ? 'Scheduling…' : `Schedule ${messages.length} Post${messages.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
