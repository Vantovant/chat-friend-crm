import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Plus, Edit2, Trash2, CheckCircle, XCircle, Loader2,
  MessageSquare, TrendingUp, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const CATEGORIES = [
  { id: 'price_question', label: 'Price Question', icon: '💰' },
  { id: 'skeptical', label: 'Skeptical / Scam Fear', icon: '🤔' },
  { id: 'wants_results', label: 'Wants Results Fast', icon: '⚡' },
  { id: 'medical_concern', label: 'Medical Concern', icon: '🩺' },
  { id: 'business_plan', label: 'Business Plan', icon: '📊' },
  { id: 'general', label: 'General', icon: '💬' },
] as const;

type Playbook = {
  id: string;
  category: string;
  title: string;
  content: string;
  approved: boolean;
  version: number;
  usage_count: number;
  conversion_count: number;
  created_at: string;
};

export function PlaybooksModule() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPlaybooks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('playbooks').select('*').order('usage_count', { ascending: false });
    if (!error && data) setPlaybooks(data as unknown as Playbook[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  const handleSave = async () => {
    if (!editTitle || !editContent) {
      toast({ title: 'Missing fields', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { data: user } = await supabase.auth.getUser();

    if (editId) {
      const { error } = await supabase.from('playbooks')
        .update({ title: editTitle, category: editCategory, content: editContent, updated_at: new Date().toISOString() })
        .eq('id', editId);
      if (error) toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      else toast({ title: 'Playbook updated' });
    } else {
      const { error } = await supabase.from('playbooks')
        .insert({ title: editTitle, category: editCategory, content: editContent, approved: true, created_by: user?.user?.id });
      if (error) toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
      else toast({ title: 'Playbook created' });
    }
    setEditOpen(false);
    resetForm();
    setSaving(false);
    fetchPlaybooks();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('playbooks').delete().eq('id', id);
    if (error) toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Playbook deleted' }); fetchPlaybooks(); }
  };

  const toggleApproval = async (id: string, current: boolean) => {
    await supabase.from('playbooks').update({ approved: !current }).eq('id', id);
    fetchPlaybooks();
  };

  const resetForm = () => { setEditId(null); setEditTitle(''); setEditCategory('general'); setEditContent(''); };

  const openEdit = (p: Playbook) => {
    setEditId(p.id);
    setEditTitle(p.title);
    setEditCategory(p.category);
    setEditContent(p.content);
    setEditOpen(true);
  };

  const filtered = selectedCategory === 'all' ? playbooks : playbooks.filter(p => p.category === selectedCategory);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl vanto-gradient flex items-center justify-center shadow-lg">
            <BookOpen size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Playbooks</h2>
            <p className="text-xs text-muted-foreground">{playbooks.length} scripts · Sales enablement library</p>
          </div>
        </div>
        <Button onClick={() => { resetForm(); setEditOpen(true); }} size="sm" className="vanto-gradient text-primary-foreground">
          <Plus size={14} className="mr-1" /> New Script
        </Button>
      </div>

      {/* Category filter */}
      <div className="px-6 py-3 border-b border-border flex gap-2 overflow-x-auto shrink-0">
        <button
          onClick={() => setSelectedCategory('all')}
          className={cn('px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
            selectedCategory === 'all' ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground border-border hover:text-foreground'
          )}
        >
          All
        </button>
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setSelectedCategory(c.id)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors flex items-center gap-1',
              selectedCategory === c.id ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground border-border hover:text-foreground'
            )}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
            <MessageSquare size={32} className="opacity-30" />
            <p className="text-sm">No playbooks yet. Create scripts for common scenarios.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(p => {
              const cat = CATEGORIES.find(c => c.id === p.category);
              const convRate = p.usage_count > 0 ? Math.round((p.conversion_count / p.usage_count) * 100) : 0;
              return (
                <div key={p.id} className="vanto-card p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat?.icon || '💬'}</span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{p.title}</p>
                        <p className="text-[10px] text-muted-foreground">{cat?.label} · v{p.version}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {p.approved ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary border border-primary/30">✓ Approved</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">Draft</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{p.content}</p>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><MessageSquare size={10} /> {p.usage_count} uses</span>
                      <span className="flex items-center gap-1"><TrendingUp size={10} /> {convRate}% conv</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => toggleApproval(p.id, p.approved)} className="p-1.5 rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors" title={p.approved ? 'Unapprove' : 'Approve'}>
                        {p.approved ? <XCircle size={13} /> : <CheckCircle size={13} />}
                      </button>
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit Playbook' : 'New Playbook'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title *</label>
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                placeholder="e.g. Handle price objection"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Category *</label>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Script Content *</label>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={8}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 resize-none"
                placeholder="Write the WhatsApp message script here..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="vanto-gradient text-primary-foreground">
              {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              {editId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
