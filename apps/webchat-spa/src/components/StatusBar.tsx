import { ConnectionDot } from './ConnectionDot';
import { Badge } from '@/components/ui/badge';
import { useTokenFetchState } from '../state/token';
import { useWebChatConnectionStatus } from '../state/connection';

type BrandColors = {
  ok?: string;
  warn?: string;
  err?: string;
};

export function StatusBar({ className, brand, show = true }: { className?: string; brand?: BrandColors; show?: boolean }) {
  const connectionStatus = useWebChatConnectionStatus();
  const tokenFetchState = useTokenFetchState();

  if (!show) {
    return null;
  }

  let text = 'Connecting…';
  let kind: 'ok' | 'warn' | 'err' = 'warn';

  if (tokenFetchState === 'error') {
    text = 'Token error';
    kind = 'err';
  } else if (connectionStatus === 'connected') {
    text = 'Connected';
    kind = 'ok';
  } else if (connectionStatus === 'failedToConnect' || connectionStatus === 'expiredToken' || connectionStatus === 'reconnecting') {
    text = 'Reconnecting…';
    kind = 'err';
  }

  return (
    <div className={className} role="status" aria-live="polite">
      <Badge variant={kind} className="gap-1.5 text-xs">
        <ConnectionDot kind={kind} brand={brand} />
        {text}
      </Badge>
    </div>
  );
}
