import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Link2, X, Phone, MessageSquare, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type UnmatchedRow = {
  id: string;
  phone_hash: string;
  phone_last4: string | null;
  last_body_preview: string | null;
  status: string;
  linked_contact_id: string | null;
  message_count: number;
  created_at: string;
  last_seen_at: string | null;
};

type ContactMatch = {
  id: string;
  name: string | null;
  phone_normalized: string | null;
  lead_type: string | null;
};

export function MaytapiUnmatchedModule() {
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<Record<string, ContactMatch[]>>({});
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("maytapi_inbound_unmatched")
      .select("*")
      .neq("status", "dismissed")
      .neq("status", "linked")
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const unmatched = (data ?? []) as UnmatchedRow[];
    setRows(unmatched);

    // Bulk-match contacts by last4 (phone_normalized ends with last4)
    const last4s = Array.from(new Set(unmatched.map(r => r.phone_last4).filter(Boolean))) as string[];
    const map: Record<string, ContactMatch[]> = {};
    await Promise.all(
      last4s.map(async (l4) => {
        const { data: cs } = await supabase
          .from("contacts")
          .select("id, full_name, phone_normalized, lead_type")
          .like("phone_normalized", `%${l4}`)
          .eq("is_deleted", false)
          .limit(10);
        map[l4] = (cs ?? []) as ContactMatch[];
      })
    );
    setMatches(map);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function linkTo(rowId: string, contactId: string) {
    setBusyId(rowId);
    const { error } = await supabase
      .from("maytapi_inbound_unmatched")
      .update({ linked_contact_id: contactId, status: "linked", updated_at: new Date().toISOString() })
      .eq("id", rowId);
    setBusyId(null);
    if (error) {
      toast({ title: "Link failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Linked", description: "Marked as linked. Open the contact in Inbox to message them." });
    setRows(prev => prev.filter(r => r.id !== rowId));
  }

  async function dismiss(rowId: string) {
    setBusyId(rowId);
    const { error } = await supabase
      .from("maytapi_inbound_unmatched")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("id", rowId);
    setBusyId(null);
    if (error) {
      toast({ title: "Dismiss failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows(prev => prev.filter(r => r.id !== rowId));
  }

  const visible = rows.filter(r => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return (r.phone_last4 || "").includes(f)
      || (r.last_body_preview || "").toLowerCase().includes(f);
  });

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Maytapi Unmatched Inbound</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inbound messages that hit the legacy webhook before the v2 flip. Raw phone numbers were never stored (privacy by design) — only a hash and the last 4 digits. Use the last-4 + body preview to identify who replied, then link to a contact.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="pt-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <strong>Limitation:</strong> the system cannot auto-send to these — last-4 alone can collide with multiple contacts and risks messaging the wrong person. Pick the right contact yourself; then go to <em>Inbox</em> or <em>Contacts</em> to reach out.
          </div>
        </CardContent>
      </Card>

      <Input
        placeholder="Filter by last-4 or message text…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-md"
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading unmatched inbound…
        </div>
      )}

      {!loading && visible.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No unmatched inbound. 🎉</CardContent></Card>
      )}

      <div className="space-y-3">
        {visible.map(row => {
          const candidates = (row.phone_last4 && matches[row.phone_last4]) || [];
          return (
            <Card key={row.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Ends in <span className="font-mono">{row.phone_last4 || "??"}</span>
                    <Badge variant="secondary">{row.message_count} msg{row.message_count !== 1 ? "s" : ""}</Badge>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    Last seen: {row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : "—"}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {row.last_body_preview && (
                  <div className="flex items-start gap-2 text-sm bg-muted/40 rounded-md p-3">
                    <MessageSquare className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                    <span className="italic">"{row.last_body_preview}"</span>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Possible contacts ({candidates.length})
                  </div>
                  {candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No contact in DB ends in {row.phone_last4}.</p>
                  ) : (
                    <div className="space-y-2">
                      {candidates.map(c => (
                        <div key={c.id} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{c.full_name || "(no name)"}</div>
                            <div className="text-xs text-muted-foreground font-mono">{c.phone_normalized}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {c.lead_type && <Badge variant="outline" className="text-xs">{c.lead_type}</Badge>}
                            <Button
                              size="sm"
                              variant="default"
                              disabled={busyId === row.id}
                              onClick={() => linkTo(row.id, c.id)}
                            >
                              <Link2 className="w-3 h-3 mr-1" /> Link
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => dismiss(row.id)}>
                    <X className="w-3 h-3 mr-1" /> Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
