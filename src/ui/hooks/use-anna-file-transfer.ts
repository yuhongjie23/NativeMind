import { useEffect, useRef, useState } from 'react';
import { stageAnnaAudio, stageAnnaDocument, stageAnnaVideo } from '@infrastructure/anna';
import type { FileTransferProgress } from '@infrastructure/anna/file-import';

type TransferState =
  | { phase: 'idle' | 'cancelled' }
  | { phase: 'transferring' | 'committing' | 'cancelling'; bytes: number; total: number };

/** Only controls the local file copy. Business imports still go through their existing stores. */
export function useAnnaFileTransfer() {
  const [state, setState] = useState<TransferState>({ phase: 'idle' });
  const active = useRef<AbortController | null>(null);
  const committing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);

  const stage = async (file: File, kind: 'document' | 'audio' | 'background'): Promise<string | undefined> => {
    if (!mounted.current || active.current) return undefined;
    const controller = new AbortController();
    active.current = controller;
    committing.current = false;
    const onProgress = (progress: FileTransferProgress) => {
      committing.current = progress.phase === 'committing';
      if (mounted.current) setState(progress);
    };
    try {
      const path = await (kind === 'background' ? stageAnnaVideo : kind === 'audio' ? stageAnnaAudio : stageAnnaDocument)(file, {
        signal: controller.signal, onProgress,
      });
      if (mounted.current) setState({ phase: 'idle' });
      return mounted.current ? path : undefined;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (mounted.current) setState({ phase: 'cancelled' });
        return undefined;
      }
      if (mounted.current) setState({ phase: 'idle' });
      throw error;
    } finally {
      active.current = null;
      committing.current = false;
    }
  };

  const cancel = () => {
    if (!active.current || committing.current) return;
    active.current.abort();
    setState((current) => 'bytes' in current ? { ...current, phase: 'cancelling' } : current);
  };
  return { state, stage, cancel, busy: 'bytes' in state };
}
