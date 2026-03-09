import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Trash2, Users, CalendarClock, Send, RefreshCw } from 'lucide-react';

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

export function GroupCampaignsModule() {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

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

  // Realtime subscription for post status updates
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
    if (!selectedGroup || !messageContent.trim() || !scheduledAt) {
      toast.error('Please fill in all fields: group, message, and schedule time.');
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      toast.error('Scheduled time must be in the future.');
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not authenticated'); setSaving(false); return; }

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
      setScheduledAt('');
      setSelectedGroup('');
      fetchData();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('scheduled_group_posts').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete: ' + error.message);
    } else {
      toast.success('Post deleted');
      fetchData();
    }
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

  // Generate a min datetime string for the input (now + 1 min)
  const minDateTime = () => {
    const d = new Date(Date.now() + 60000);
    return d.toISOString().slice(0, 16);
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

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Message Content</label>
                <Textarea
                  value={messageContent}
                  onChange={e => setMessageContent(e.target.value)}
                  placeholder="Type the message to post in the group…"
                  rows={4}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Schedule Time</label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  min={minDateTime()}
                />
              </div>

              <Button onClick={handleSchedule} disabled={saving} className="w-full sm:w-auto">
                <Plus size={16} />
                {saving ? 'Scheduling…' : 'Schedule Campaign'}
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
                    <TableHead className="w-[60px]"></TableHead>
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
                        {post.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-400"
                            onClick={() => handleDelete(post.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
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
