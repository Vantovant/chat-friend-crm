import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Globe, Loader2, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type Brand = { brand_name: string; website_url: string; shop_url: string; facebook_page_url: string };
const EMPTY: Brand = { brand_name: '', website_url: '', shop_url: '', facebook_page_url: '' };

const FIELDS: { key: keyof Brand; label: string; placeholder: string }[] = [
  { key: 'brand_name', label: 'Brand name', placeholder: 'e.g. Matilda Wellness & APLGO' },
  { key: 'website_url', label: 'My website', placeholder: 'https://yourwebsite.com' },
  { key: 'shop_url', label: 'My shop link', placeholder: 'https://yourwebsite.com/shop' },
  { key: 'facebook_page_url', label: 'My Facebook Page link', placeholder: 'https://www.facebook.com/YourPage' },
];

/** Per-user brand links. Each user only ever sees and saves their own row. */
export function BrandLinksCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<Brand>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      const { data } = await supabase.from('user_brand_settings')
        .select('brand_name,website_url,shop_url,facebook_page_url').eq('user_id', user.id).maybeSingle();
      if (data) setForm({
        brand_name: data.brand_name ?? '', website_url: data.website_url ?? '',
        shop_url: data.shop_url ?? '', facebook_page_url: data.facebook_page_url ?? '',
      });
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!userId) return;
    for (const f of FIELDS) {
      const v = form[f.key].trim();
      if (f.key !== 'brand_name' && v && !/^https?:\/\//i.test(v)) {
        toast({ title: `${f.label} must start with https://`, variant: 'destructive' });
        return;
      }
    }
    setSaving(true);
    const clean = (v: string) => v.trim() || null;
    const { error } = await supabase.from('user_brand_settings').upsert({
      user_id: userId, brand_name: clean(form.brand_name), website_url: clean(form.website_url),
      shop_url: clean(form.shop_url), facebook_page_url: clean(form.facebook_page_url),
    }, { onConflict: 'user_id' });
    setSaving(false);
    if (error) toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
    else toast({ title: 'Your links are saved' });
  };

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5"><Globe className="h-5 w-5 text-primary" /></div>
        <div>
          <h3 className="text-base font-semibold text-foreground">My brand links</h3>
          <p className="mt-1 text-sm text-muted-foreground">Your own website, shop and Facebook Page. Only you can see these, and they are never shared with other accounts.</p>
        </div>
      </div>
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-5 space-y-3">
          {FIELDS.map(f => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
              <input
                value={form[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60"
              />
              {!form[f.key].trim() && <span className="mt-1 block text-[11px] text-muted-foreground">Not set — add your link</span>}
            </label>
          ))}
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save my links
          </button>
        </div>
      )}
    </div>
  );
}

export default BrandLinksCard;
