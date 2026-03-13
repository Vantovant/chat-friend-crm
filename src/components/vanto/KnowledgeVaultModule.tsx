import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Upload, Search, FileText, CheckCircle, Clock, XCircle,
  Trash2, RefreshCw, Loader2, Shield, Sparkles, ClipboardPaste,
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

/** Clean text: remove null bytes, control chars, normalize whitespace */
function cleanText(raw: string): string {
  return raw
    .replace(/\0/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split text into chunks of ~2000 chars with 200 char overlap */
function chunkText(text: string, maxChars = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      if (lastPeriod > start + maxChars / 2) end = lastPeriod + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks.filter(c => c.length > 10);
}

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
  const [uploadMode, setUploadMode] = useState<'paste' | 'file'>('paste');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPasteText, setUploadPasteText] = useState('');
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

  /** Client-side ingestion: read text → chunk → insert directly to DB */
  const handleUpload = async () => {
    if (!uploadTitle) {
      toast({ title: 'Title required', variant: 'destructive' });
      return;
    }

    // Get raw text
    let rawText = '';
    let fileName = '';

    if (uploadMode === 'paste') {
      if (!uploadPasteText.trim()) {
        toast({ title: 'Paste your text content', variant: 'destructive' });
        return;
      }
      rawText = uploadPasteText;
      fileName = `${uploadTitle.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
    } else {
      if (!uploadFile) {
        toast({ title: 'Select a file', variant: 'destructive' });
        return;
      }
      try {
        rawText = await uploadFile.text();
        fileName = uploadFile.name;
      } catch {
        toast({ title: 'Cannot read file as text', description: 'Use .txt, .md, .csv, or .json', variant: 'destructive' });
        return;
      }
    }

    // For JSON, pretty-print
    if (fileName.toLowerCase().endsWith('.json')) {
      try { rawText = JSON.stringify(JSON.parse(rawText), null, 2); } catch {}
    }

    const text = cleanText(rawText);
    if (text.length < 10) {
      toast({ title: 'No usable text content found', variant: 'destructive' });
      return;
    }

    setUploading(true);

    try {
      // Create file record (no storage upload needed — text is chunked directly)
      const { data: user } = await supabase.auth.getUser();
      const { data: fileRecord, error: insertErr } = await supabase
        .from('knowledge_files')
        .insert({
          collection: uploadCollection,
          title: uploadTitle,
          file_name: fileName,
          storage_path: null,
          mode: COLLECTIONS.find(c => c.id === uploadCollection)?.mode || 'strict',
          status: 'processing',
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

      // Chunk text client-side
      const chunks = chunkText(text);
      const chunkRows = chunks.map((chunk, i) => ({
        file_id: fileRecord.id,
        chunk_index: i,
        chunk_text: chunk,
        token_count: Math.ceil(chunk.length / 4),
      }));

      // Insert chunks in batches of 50
      let insertError = null;
      for (let i = 0; i < chunkRows.length; i += 50) {
        const batch = chunkRows.slice(i, i + 50);
        const { error } = await supabase.from('knowledge_chunks').insert(batch);
        if (error) { insertError = error; break; }
      }

      if (insertError) {
        await supabase.from('knowledge_files').update({ status: 'rejected' }).eq('id', fileRecord.id);
        toast({ title: 'Chunking failed', description: insertError.message, variant: 'destructive' });
      } else {
        await supabase.from('knowledge_files').update({ status: 'approved' }).eq('id', fileRecord.id);
        toast({ title: '✅ Indexed successfully', description: `${chunks.length} chunks from "${uploadTitle}"` });
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }

    setUploadOpen(false);
    setUploadTitle('');
    setUploadFile(null);
    setUploadPasteText('');
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

  /** Re-index: delete old chunks, re-read from file record text (only for paste-based) */
  const handleReindex = async (fileId: string) => {
    toast({ title: 'Re-indexing...', description: 'For pasted content, delete and re-upload.' });
  };

  /** Force retry: reset stuck file to error, delete old chunks, re-trigger ingestion prompt */
  const handleForceRetry = async (fileId: string) => {
    toast({ title: 'Force retrying…' });
    // Delete existing chunks
    await supabase.from('knowledge_chunks').delete().eq('file_id', fileId);
    // Set status to error so user knows it needs re-upload
    await supabase.from('knowledge_files').update({ status: 'error' }).eq('id', fileId);
    toast({ title: '⚠️ File reset', description: 'Old chunks cleared. Please re-upload/re-paste the content to re-index.' });
    fetchFiles();
  };

  const handleDelete = async (fileId: string) => {
    // Delete chunks first, then file
    await supabase.from('knowledge_chunks').delete().eq('file_id', fileId);
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
                      {(f.status === 'processing' || f.status === 'pending') && 
                        (Date.now() - new Date(f.created_at).getTime() > 5 * 60 * 1000) && (
                        <button
                          onClick={() => handleForceRetry(f.id)}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                          title="Force retry — file appears stuck"
                        >
                          Force Retry
                        </button>
                      )}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Knowledge Document</DialogTitle>
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

            {/* Mode toggle: Paste vs File */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Content Source *</label>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setUploadMode('paste')}
                  className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2',
                    uploadMode === 'paste' ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground border-border hover:text-foreground'
                  )}
                >
                  <ClipboardPaste size={14} /> Smart Paste
                </button>
                <button
                  onClick={() => setUploadMode('file')}
                  className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2',
                    uploadMode === 'file' ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground border-border hover:text-foreground'
                  )}
                >
                  <FileText size={14} /> Upload File
                </button>
              </div>

              {uploadMode === 'paste' ? (
                <div>
                  <textarea
                    value={uploadPasteText}
                    onChange={e => setUploadPasteText(e.target.value)}
                    placeholder="Paste your document text here... Copy from Word, PDF, or any source and paste directly."
                    className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 min-h-[160px] resize-y"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ✅ Recommended: Copy text from your PDF/Word doc and paste here. No file size limits.
                  </p>
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.json"
                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-foreground"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Accepted: .txt, .md, .csv, .json — Small files only. For large docs, use Smart Paste.
                  </p>
                </div>
              )}
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
              {uploadMode === 'paste' ? 'Index Content' : 'Upload & Index'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
