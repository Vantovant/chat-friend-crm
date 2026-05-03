import { useEffect, useState } from 'react';
import { Download, Share, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // @ts-ignore iOS
    window.navigator.standalone === true
  );
}

function detectPlatform(): 'android' | 'ios' | 'desktop' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/windows|mac|linux/.test(ua)) return 'desktop';
  return 'other';
}

interface Props {
  variant?: 'button' | 'compact';
  className?: string;
}

export function InstallAppButton({ variant = 'button', className }: Props) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showHelp, setShowHelp] = useState(false);
  const platform = detectPlatform();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferred(null);
    } else {
      setShowHelp(true);
    }
  };

  const label = platform === 'ios' ? 'Add to Home Screen' : 'Install App';

  return (
    <>
      {variant === 'compact' ? (
        <button
          onClick={handleClick}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium vanto-gradient text-primary-foreground shadow-md ${className ?? ''}`}
        >
          <Download size={14} />
          <span>{label}</span>
        </button>
      ) : (
        <Button onClick={handleClick} className={`vanto-gradient text-primary-foreground ${className ?? ''}`}>
          <Download size={16} />
          {label}
        </Button>
      )}

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone size={18} /> Install Vanto on your phone
            </DialogTitle>
            <DialogDescription>
              Add Vanto CRM to your home screen so it opens like a native app.
            </DialogDescription>
          </DialogHeader>

          {platform === 'android' && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">Android (Chrome):</p>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Tap the <strong>⋮</strong> menu (top right of Chrome).</li>
                <li>Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                <li>Confirm. The Vanto icon will appear on your home screen.</li>
              </ol>
            </div>
          )}

          {platform === 'ios' && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">iPhone / iPad (Safari):</p>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Tap the <Share size={14} className="inline" /> <strong>Share</strong> button.</li>
                <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong>. The Vanto icon will appear on your home screen.</li>
              </ol>
            </div>
          )}

          {(platform === 'desktop' || platform === 'other') && (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Open this page on your phone (Chrome on Android or Safari on iPhone) to install Vanto to your home screen.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
