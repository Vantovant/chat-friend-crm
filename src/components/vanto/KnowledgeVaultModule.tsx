import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Upload, Search, FileText, CheckCircle, Clock, XCircle,
  Trash2, RefreshCw, Loader2, Shield, Sparkles, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const COLLECTIONS = [
  { id: 'general', label: 'General Knowledge & App Manual', icon: '📘', mode: 'assisted' },
  { id: 'opportunity', label: 'Business Opportunity', icon: '🚀', mode: 'strict' },
  { id: 'compensation', label: 'Compensation', icon: '💰', mode: 'strict' },
  { id: 'products', label: 'Product Prices & Benefits', icon: '🧴', mode: 'strict' },
  { id: 'orders', label: 'Orders & Deliveries', icon: '📦', mode: 'strict' },
  { id: 'motivation', label: 'MLM & Wellness Motivation', icon: '✨', mode: 'assisted' },
] as const;

type KnowledgeFile = {
  id: string;
  collection: string;
  title: string;
  file_name: string;
  status: string;
  mode: string;
  version: number;
  effective_date: string | null;
  expiry_date: string | null;
  created_at: string;
  tags: string[];
};

type SearchResult = {
  chunk_id: string;
  file_id: string;
  chunk_text: string;
  file_title: string;
  file_collection: string;
  relevance: number;
};

export function KnowledgeVaultModule() {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'search'>('files');

  // Upload form state
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCollection, setUploadCollection] = useState('products');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadEffective, setUploadEffective] = useState('');
  const [uploadExpiry, setUploadExpiry] = useState('');

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const query = supabase.from('knowledge_files').select('*').order('created_at', { ascending: false });
    const { data, error } = await query;
    if (!error && data) setFiles(data as unknown as KnowledgeFile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle) {
      toast({ title: 'Missing fields', description: 'Title and file required', variant: 'destructive' });
      return;
    }
    setUploading(true);

    const safeName = uploadFile.name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    const storagePath = `${uploadCollection}/${Date.now()}-${safeName}`;

    // Upload file to storage
    const { error: storageErr } = await supabase.storage
      .from('knowledge-vault')
      .upload(storagePath, uploadFile);

    if (storageErr) {
      toast({ title: 'Upload failed', description: storageErr.message, variant: 'destructive' });
      setUploading(false);
      return;
    }

    // Create file record
    const { data: user } = await supabase.auth.getUser();
    const { data: fileRecord, error: insertErr } = await supabase
      .from('knowledge_files')
      .insert({
        collection: uploadCollection,
        title: uploadTitle,
        file_name: uploadFile.name,
        storage_path: storagePath,
        mode: COLLECTIONS.find(c => c.id === uploadCollection)?.mode || 'strict',
        effective_date: uploadEffective || null,
        expiry_date: uploadExpiry || null,
        created_by: user?.user?.id,
      })
      .select('id')
      .single();

    if (insertErr || !fileRecord) {
      toast({ title: 'Failed to create record', description: insertErr?.message, variant: 'destructive' });
      setUploading(false);
      return;
    }

    // Trigger ingestion
    const { error: ingestErr } = await supabase.functions.invoke('knowledge-ingest', {
      body: { file_id: fileRecord.id },
    });

    if (ingestErr) {
      toast({ title: 'Ingestion warning', description: 'File saved but chunking failed. Try re-indexing.', variant: 'destructive' });
    } else {
      toast({ title: 'File uploaded & indexed', description: `${uploadFile.name} is now searchable` });
    }

    setUploadOpen(false);
    setUploadTitle('');
    setUploadFile(null);
    setUploadEffective('');
    setUploadExpiry('');
    setUploading(false);
    fetchFiles();
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const { data, error } = await supabase.functions.invoke('knowledge-search', {
      body: {
        query: searchQuery,
        collection: selectedCollection === 'all' ? null : selectedCollection,
        max_results: 10,
      },
    });
    if (!error && data?.results) setSearchResults(data.results);
    else toast({ title: 'Search failed', description: error?.message || data?.error, variant: 'destructive' });
    setSearching(false);
  };

  const handleReindex = async (fileId: string) => {
    toast({ title: 'Re-indexing...' });
    const { error } = await supabase.functions.invoke('knowledge-ingest', {
      body: { file_id: fileId },
    });
    if (error) toast({ title: 'Re-index failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Re-indexed successfully' }); fetchFiles(); }
  };

  const handleDelete = async (fileId: string) => {
    const { error } = await supabase.from('knowledge_files').delete().eq('id', fileId);
    if (error) toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'File deleted' }); fetchFiles(); }
  };

  const filteredFiles = selectedCollection === 'all'
    ? files
    : files.filter(f => f.collection === selectedCollection);

  const statusIcon = (s: string) => {
    if (s === 'approved') return <CheckCircle size={14} className="text-primary" />;
    if (s === 'processing') return <Loader2 size={14} className="animate-spin text-amber-500" />;
    if (s === 'rejected') return <XCircle size={14} className="text-destructive" />;
    return <Clock size={14} className="text-muted-foreground" />;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl vanto-gradient flex items-center justify-center shadow-lg">
            <BookOpen size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Knowledge Vault</h2>
            <p className="text-xs text-muted-foreground">{files.length} files · Grounding layer for Zazi Copilot</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(['files', 'search'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
                activeTab === tab ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              )}
            >
              {tab === 'files' ? '📁 Files' : '🔍 Search'}
            </button>
          ))}
          <Button onClick={() => setUploadOpen(true)} size="sm" className="vanto-gradient text-primary-foreground">
            <Upload size={14} className="mr-1" /> Upload
          </Button>
        </div>
      </div>

      {/* Collections filter */}
      <div className="px-6 py-3 border-b border-border flex gap-2 overflow-x-auto shrink-0">
        <button
          onClick={() => setSelectedCollection('all')}
          className={cn('px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
            selectedCollection === 'all' ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground border-border hover:text-foreground'
          )}
        >
          All Collections
        </button>
        {COLLECTIONS.map(c => (
          <button
            key={c.id}
            onClick={() => setSelectedCollection(c.id)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors flex items-center gap-1',
              selectedCollection === c.id ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground border-border hover:text-foreground'
            )}
          >
            <span>{c.icon}</span> {c.label}
            {c.mode === 'strict' && <Shield size={10} className="text-amber-500" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'files' ? (
          loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading files...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
              <BookOpen size={32} className="opacity-30" />
              <p className="text-sm">No files yet. Upload documents to ground Zazi in facts.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFiles.map(f => {
                const col = COLLECTIONS.find(c => c.id === f.collection);
                const isExpired = f.expiry_date && new Date(f.expiry_date) < new Date();
                return (
                  <div key={f.id} className={cn('vanto-card p-4 flex items-center gap-4', isExpired && 'opacity-60')}>
                    <div className="text-2xl">{col?.icon || '📄'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm text-foreground truncate">{f.title}</span>
                        {statusIcon(f.status)}
                        {f.mode === 'strict' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">STRICT</span>
                        )}
                        {isExpired && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-destructive/15 text-destructive border border-destructive/30">EXPIRED</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{f.file_name} · v{f.version} · {col?.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Added {new Date(f.created_at).toLocaleDateString()}
                        {f.effective_date && ` · Effective ${new Date(f.effective_date).toLocaleDateString()}`}
                        {f.expiry_date && ` · Expires ${new Date(f.expiry_date).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => handleReindex(f.id)} className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors" title="Re-index">
                        <RefreshCw size={14} />
                      </button>
                      <button onClick={() => handleDelete(f.id)} className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Search tab */
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search knowledge base (e.g. 'product prices', 'compensation plan')..."
                  className="w-full bg-secondary/60 border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
              </div>
              <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()} size="sm">
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                <span className="ml-1">Search</span>
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{searchResults.length} results found</p>
                {searchResults.map((r, i) => {
                  const col = COLLECTIONS.find(c => c.id === r.file_collection);
                  return (
                    <div key={r.chunk_id} className="vanto-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm">{col?.icon || '📄'}</span>
                        <span className="text-xs font-semibold text-foreground">{r.file_title}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-secondary border border-border text-muted-foreground">{r.file_collection}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">Score: {r.relevance.toFixed(3)}</span>
                      </div>
                      <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{r.chunk_text.slice(0, 500)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {!searching && searchResults.length === 0 && searchQuery && (
              <div className="text-center text-muted-foreground text-sm py-8">
                <Sparkles size={24} className="mx-auto mb-2 opacity-30" />
                No results. Try different keywords or upload more documents.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Knowledge Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title *</label>
              <input
                value={uploadTitle}
                onChange={e => setUploadTitle(e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                placeholder="e.g. Product Price List Q1 2026"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Collection *</label>
              <select
                value={uploadCollection}
                onChange={e => setUploadCollection(e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                {COLLECTIONS.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.label} ({c.mode})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">File *</label>
              <input
                type="file"
              accept=".txt,.md,.csv,.json,.pdf"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-foreground"
              />
              <p className="text-[10px] text-muted-foreground mt-1">✅ Best: .txt, .md, .csv, .json &nbsp;|&nbsp; ⚠️ PDF may fail — convert to .txt first</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Effective Date</label>
                <input
                  type="date"
                  value={uploadEffective}
                  onChange={e => setUploadEffective(e.target.value)}
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Expiry Date</label>
                <input
                  type="date"
                  value={uploadExpiry}
                  onChange={e => setUploadExpiry(e.target.value)}
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading} className="vanto-gradient text-primary-foreground">
              {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
              Upload & Index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
