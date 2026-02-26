/**
 * Vanto CRM — knowledge-ingest Edge Function
 * Takes a file_id, reads the file from storage, chunks text, stores chunks.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Split text into chunks of ~400 tokens (roughly 2000 chars), overlapping by 200 chars */
function chunkText(text: string, maxChars = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // Try to break at sentence boundary
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const { file_id } = body;
  if (!file_id) return jsonRes({ error: 'file_id required' }, 400);

  // Get file record
  const { data: file, error: fileErr } = await serviceClient
    .from('knowledge_files')
    .select('*')
    .eq('id', file_id)
    .single();

  if (fileErr || !file) return jsonRes({ error: 'File not found' }, 404);

  // Update status to processing
  await serviceClient.from('knowledge_files').update({ status: 'processing' }).eq('id', file_id);

  try {
    // Download file from storage
    const { data: fileData, error: dlErr } = await serviceClient.storage
      .from('knowledge-vault')
      .download(file.storage_path);

    if (dlErr || !fileData) {
      await serviceClient.from('knowledge_files').update({ status: 'rejected' }).eq('id', file_id);
      return jsonRes({ error: 'Could not download file: ' + (dlErr?.message || 'unknown') }, 500);
    }

    // Extract text (support .txt, .md, .csv — for PDF we'd need a parser)
    let text = '';
    const fileName = file.file_name.toLowerCase();
    
    if (fileName.endsWith('.txt') || fileName.endsWith('.md') || fileName.endsWith('.csv')) {
      text = await fileData.text();
    } else if (fileName.endsWith('.json')) {
      const jsonContent = await fileData.text();
      text = JSON.stringify(JSON.parse(jsonContent), null, 2);
    } else {
      // For other formats, try reading as text
      text = await fileData.text();
    }

    if (!text || text.length < 10) {
      await serviceClient.from('knowledge_files').update({ status: 'rejected' }).eq('id', file_id);
      return jsonRes({ error: 'File has no extractable text content' }, 400);
    }

    // Delete existing chunks for this file (re-ingest)
    await serviceClient.from('knowledge_chunks').delete().eq('file_id', file_id);

    // Chunk and store
    const chunks = chunkText(text);
    const chunkRows = chunks.map((chunk, i) => ({
      file_id: file_id,
      chunk_index: i,
      chunk_text: chunk,
      token_count: Math.ceil(chunk.length / 4), // rough estimate
    }));

    const { error: insertErr } = await serviceClient
      .from('knowledge_chunks')
      .insert(chunkRows);

    if (insertErr) {
      await serviceClient.from('knowledge_files').update({ status: 'rejected' }).eq('id', file_id);
      return jsonRes({ error: 'Failed to store chunks: ' + insertErr.message }, 500);
    }

    // Mark as approved
    await serviceClient.from('knowledge_files').update({ status: 'approved' }).eq('id', file_id);

    return jsonRes({ 
      success: true, 
      chunks_created: chunks.length,
      total_chars: text.length,
    });
  } catch (err: any) {
    await serviceClient.from('knowledge_files').update({ status: 'rejected' }).eq('id', file_id);
    return jsonRes({ error: err.message }, 500);
  }
});
