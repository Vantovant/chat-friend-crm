import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { format, eachDayOfInterval, setHours, setMinutes } from 'date-fns';
import { Plus, Trash2, Users, CalendarClock, Send, RefreshCw, CalendarIcon, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

type WhatsAppGroup = { id: string; group_name: string; created_at: string };
type ScheduledPost = {
  id: string;
  target_group_name: string;
  message_content: string;
  image_url: string | null;
  scheduled_at: string;
  status: string;
  created_at: string;
};

const TIME_SLOTS = [
  { id: 'morning', label: 'Morning (08:00)', hour: 8, minute: 0 },
  { id: 'midday', label: 'Mid-day (13:00)', hour: 13, minute: 0 },
  { id: 'evening', label: 'Evening (18:00)', hour: 18, minute: 0 },
] as const;

export function GroupCampaignsModule() {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [isBulk, setIsBulk] = useState(false);

  // Single post date/time
  const [singleDate, setSingleDate] = useState<Date | undefined>();
  const [singleTime, setSingleTime] = useState('09:00');

  // Bulk campaign state
  const [bulkDateRange, setBulkDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<string[]>(['morning']);

  const fetchData = async () => {
    setLoading(true);
    const [groupsRes, postsRes] = await Promise.all([
      supabase.from('whatsapp_groups').select('*').order('group_name'),
      supabase.from('scheduled_group_posts').select('*').order('scheduled_at', { ascending: false }),
    ]);
    if (groupsRes.data) setGroups(groupsRes.data as WhatsAppGroup[]);
    if (postsRes.data) setPosts(postsRes.data as ScheduledPost[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const channel = supabase
      .channel('group-posts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_group_posts' }, () => {
        fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleSchedule = async () => {
    if (!selectedGroup || !messageContent.trim()) {
      toast.error('Please fill in group and message.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not authenticated'); return; }

    setSaving(true);

    try {
      if (isBulk) {
        // Bulk campaign
        if (!bulkDateRange.from || !bulkDateRange.to) {
          toast.error('Select a date range for bulk campaign.');
          setSaving(false);
          return;
        }
        if (selectedTimeSlots.length === 0) {
          toast.error('Select at least one posting time.');
          setSaving(false);
          return;
        }

        const days = eachDayOfInterval({ start: bulkDateRange.from, end: bulkDateRange.to });
        const rows: any[] = [];
        const now = new Date();

        for (const day of days) {
          for (const slotId of selectedTimeSlots) {
            const slot = TIME_SLOTS.find(s => s.id === slotId);
            if (!slot) continue;
            const scheduledDate = setMinutes(setHours(day, slot.hour), slot.minute);
            if (scheduledDate <= now) continue; // skip past times
            rows.push({
              user_id: user.id,
              target_group_name: selectedGroup,
              message_content: messageContent.trim(),
              scheduled_at: scheduledDate.toISOString(),
              status: 'pending',
            });
          }
        }

        if (rows.length === 0) {
          toast.error('No future time slots in the selected range.');
          setSaving(false);
          return;
        }

        const { error } = await supabase.from('scheduled_group_posts').insert(rows);
        if (error) {
          toast.error('Failed to schedule: ' + error.message);
        } else {
          toast.success(`${rows.length} campaign posts scheduled!`);
          setMessageContent('');
          setSelectedGroup('');
          setBulkDateRange({ from: undefined, to: undefined });
          setSelectedTimeSlots(['morning']);
          fetchData();
        }
      } else {
        // Single post
        if (!singleDate) {
          toast.error('Pick a date.');
          setSaving(false);
          return;
        }
        const [h, m] = singleTime.split(':').map(Number);
        const scheduledDate = setMinutes(setHours(singleDate, h), m);
        if (scheduledDate <= new Date()) {
          toast.error('Scheduled time must be in the future.');
          setSaving(false);
          return;
        }

        const { error } = await supabase.from('scheduled_group_posts').insert({
          user_id: user.id,
          target_group_name: selectedGroup,
          message_content: messageContent.trim(),
          scheduled_at: scheduledDate.toISOString(),
          status: 'pending',
        } as any);

        if (error) {
          toast.error('Failed to schedule: ' + error.message);
        } else {
          toast.success('Campaign scheduled!');
          setMessageContent('');
          setSingleDate(undefined);
          setSingleTime('09:00');
          setSelectedGroup('');
          fetchData();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('scheduled_group_posts').delete().eq('id', id);
    if (error) toast.error('Failed to delete: ' + error.message);
    else { toast.success('Post deleted'); fetchData(); }
  };

  const handleRetry = async (id: string) => {
    const { error } = await supabase.from('scheduled_group_posts').update({ status: 'pending' }).eq('id', id);
    if (error) toast.error('Retry failed: ' + error.message);
    else { toast.success('Post queued for retry'); fetchData(); }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Sent</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/15 text-red-400 border-red-500/30">Failed</Badge>;
      default:
        return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">Pending</Badge>;
    }
  };

  const toggleTimeSlot = (slotId: string) => {
    setSelectedTimeSlots(prev =>
      prev.includes(slotId) ? prev.filter(s => s !== slotId) : [...prev, slotId]
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Users size={24} className="text-primary" />
            Group Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Schedule messages to WhatsApp groups via Chrome Extension
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Scheduler Form */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock size={18} className="text-primary" />
            Schedule New Campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.length === 0 ? (
            <div className="text-sm text-muted-foreground bg-secondary/40 rounded-lg p-4 text-center">
              <Users size={32} className="mx-auto mb-2 text-muted-foreground/50" />
              <p className="font-medium">No groups captured yet</p>
              <p className="text-xs mt-1">
                Open WhatsApp Web with the Vanto Chrome Extension active, then click on a group chat to capture it.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Target Group</label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a captured group…" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map(g => (
                      <SelectItem key={g.id} value={g.group_name}>{g.group_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Bulk toggle */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border">
                <Switch checked={isBulk} onCheckedChange={setIsBulk} />
                <div>
                  <p className="text-sm font-medium text-foreground">{isBulk ? 'Smart Bulk Campaign' : 'Single Post'}</p>
                  <p className="text-xs text-muted-foreground">{isBulk ? 'Schedule across a date range with multiple time slots' : 'Schedule one post at a specific date & time'}</p>
                </div>
              </div>

              {!isBulk ? (
                /* Single post: Calendar popover + time */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !singleDate && "text-muted-foreground")}>
                          <CalendarIcon size={14} className="mr-2" />
                          {singleDate ? format(singleDate, 'PPP') : 'Pick a date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={singleDate}
                          onSelect={setSingleDate}
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Time</label>
                    <Input type="time" value={singleTime} onChange={e => setSingleTime(e.target.value)} />
                  </div>
                </div>
              ) : (
                /* Bulk campaign: date range + time slots */
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Date Range</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !bulkDateRange.from && "text-muted-foreground")}>
                          <CalendarIcon size={14} className="mr-2" />
                          {bulkDateRange.from && bulkDateRange.to
                            ? `${format(bulkDateRange.from, 'MMM d')} – ${format(bulkDateRange.to, 'MMM d, yyyy')}`
                            : 'Select date range'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="range"
                          selected={bulkDateRange}
                          onSelect={(range) => setBulkDateRange({ from: range?.from, to: range?.to })}
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                          numberOfMonths={2}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Posting Times</label>
                    <div className="flex flex-wrap gap-3">
                      {TIME_SLOTS.map(slot => (
                        <label key={slot.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={selectedTimeSlots.includes(slot.id)}
                            onCheckedChange={() => toggleTimeSlot(slot.id)}
                          />
                          <span className="text-sm text-foreground">{slot.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  {isBulk ? 'Master Script / Content' : 'Message Content'}
                </label>
                <Textarea
                  value={messageContent}
                  onChange={e => setMessageContent(e.target.value)}
                  placeholder={isBulk ? 'Enter the master script that will be posted at each scheduled time…' : 'Type the message to post in the group…'}
                  rows={isBulk ? 6 : 4}
                />
              </div>

              <Button onClick={handleSchedule} disabled={saving} className="w-full sm:w-auto">
                <Plus size={16} />
                {saving ? 'Scheduling…' : isBulk ? 'Schedule Bulk Campaign' : 'Schedule Campaign'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Campaigns Dashboard */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send size={18} className="text-primary" />
            Scheduled Posts
            <Badge variant="secondary" className="ml-auto">{posts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No scheduled posts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map(post => (
                    <TableRow key={post.id}>
                      <TableCell className="font-medium text-sm">{post.target_group_name}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{post.message_content}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(post.scheduled_at), 'MMM d, HH:mm')}
                      </TableCell>
                      <TableCell>{statusBadge(post.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {post.status === 'failed' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-amber-400"
                              onClick={() => handleRetry(post.id)}
                              title="Retry"
                            >
                              <RotateCcw size={14} />
                            </Button>
                          )}
                          {(post.status === 'pending' || post.status === 'failed') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-red-400"
                              onClick={() => handleDelete(post.id)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
