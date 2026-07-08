/**
 * Application entry point - preloads runtime assets, then renders <App/>.
 */
import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { App } from '@/app/app';
import { BootScreen } from '@/pwa/boot_screen';
import {
  preloadRuntimeAssets,
  registerServiceWorker,
  type PreloadProgress,
} from '@/pwa/preload';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const initialProgress: PreloadProgress = {
  completed: 0,
  total: 0,
  currentLabel: 'runtime',
};

function Root() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<PreloadProgress>(initialProgress);

  const boot = useCallback(async () => {
    setReady(false);
    setError('');
    setProgress(initialProgress);

    try {
      await registerServiceWorker().catch((err: unknown) => {
        console.warn('Service worker registration failed:', err);
      });
      await preloadRuntimeAssets(setProgress);
      setReady(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!ready) {
    return <BootScreen error={error} progress={progress} onRetry={boot} />;
  }

  return <App />;
}

render(<Root />, root);
