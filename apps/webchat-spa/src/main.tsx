import { StrictMode, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';
import { prepareExperience, PreparedExperience, resolvePublicUrl } from './bootstrap';
import { StatusBar } from './components/StatusBar';
import { sanitizeShellHtml } from './sanitizeShellHtml';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LoadingState {
  status: 'loading';
}

interface ReadyState {
  status: 'ready';
  data: PreparedExperience;
}

interface ErrorState {
  status: 'error';
  message: string;
}

type AppState = LoadingState | ReadyState | ErrorState;

function LoadingSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 pt-8">
      <Card className="widget-card-wrapper widget-accent-top w-full max-w-[960px] animate-fade-in overflow-hidden border-0">
        {/* Shimmer header */}
        <CardHeader className="flex-row items-center justify-between space-y-0 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="loading-shimmer h-8 w-28 rounded-md" />
            <div className="loading-shimmer h-4 w-20 rounded-md" />
          </div>
          <div className="loading-shimmer h-6 w-24 rounded-full" />
        </CardHeader>

        {/* Shimmer body */}
        <CardContent className="p-0">
          <div className="flex flex-col items-center justify-center gap-4 border-t border-border/50 py-36">
            <div className="spinner" />
            <p className="text-sm font-medium text-muted-foreground">Connecting to agent…</p>
          </div>
        </CardContent>

        {/* Footer placeholder */}
        <CardFooter className="justify-center border-t border-border/50 px-6 py-3">
          <div className="loading-shimmer h-3 w-32 rounded-md" />
        </CardFooter>
      </Card>
    </div>
  );
}

function ErrorDisplay({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="widget-card-wrapper w-full max-w-md animate-fade-in overflow-hidden border-0">
        <CardContent className="px-6 pt-8 pb-2">
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="font-semibold">Something went wrong</AlertTitle>
            <AlertDescription className="mt-1 text-sm">{message}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex-col gap-3 px-6 pb-8 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Check the browser console for more details.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

const App = () => {
  const [state, setState] = useState<AppState>({ status: 'loading' });
  const hasRendered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await prepareExperience();
        if (!cancelled) {
          hasRendered.current = false;
          setState({ status: 'ready', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: (error as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'ready') {
      return;
    }
    const mount = document.getElementById('webchat');
    if (!mount) {
      setState({ status: 'error', message: 'WebChat mount node not found in the DOM.' });
      return;
    }
    if (hasRendered.current) {
      return;
    }
    state.data
      .renderWebChat(mount)
      .then(() => {
        hasRendered.current = true;
      })
      .catch((error) => {
        setState({ status: 'error', message: (error as Error).message });
      });
  }, [state]);

  if (state.status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (state.status === 'error') {
    return <ErrorDisplay message={state.message} />;
  }

  if (state.data.mode === 'fullpage') {
    return (
      <div className="fullpage-shell">
        <StatusBar
          brand={state.data.skin.statusBar?.brand}
          className="fullpage-status"
          show={state.data.skin.statusBar?.show}
        />
        {/* Full-page template is sanitized with DOMPurify to mitigate XSS. */}
        <div
          className="fullpage-shell-content"
          dangerouslySetInnerHTML={{ __html: sanitizeShellHtml(state.data.shellHtml) }}
        />
      </div>
    );
  }

  const { skin } = state.data;
  const logoUrl = resolvePublicUrl(skin.brand.logo);

  return (
    <div className="flex min-h-screen items-start justify-center p-4 pt-8">
      <Card className="widget-card-wrapper widget-accent-top w-full max-w-[960px] animate-slide-up overflow-hidden border-0">
        {/* Header: brand + status */}
        <CardHeader className="flex-row items-center justify-between space-y-0 px-6 py-4">
          <div className="flex items-center gap-3">
            <img
              src={logoUrl}
              alt={`${skin.brand.name} logo`}
              className="h-8 w-auto object-contain"
            />
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-tight text-foreground">
                {skin.brand.name}
              </span>
              <span className="text-xs text-muted-foreground">Digital Worker</span>
            </div>
          </div>
          <StatusBar brand={skin.statusBar?.brand} show={skin.statusBar?.show} />
        </CardHeader>

        {/* WebChat surface */}
        <CardContent className="p-0">
          <div id="webchat" className="widget-surface min-h-[520px]" aria-live="polite" />
        </CardContent>

        {/* Footer */}
        <CardFooter className="justify-center border-t border-border/50 px-6 py-3">
          <span className="text-xs text-muted-foreground">
            Powered by{' '}
            <span className="font-semibold bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] bg-clip-text text-transparent">
              Greentic
            </span>
          </span>
        </CardFooter>
      </Card>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
