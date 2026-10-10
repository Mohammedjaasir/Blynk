import { useEffect, useState } from 'react';
import { riderDocuments } from '../api/riderDocuments';
import { errorMessage } from '../lib/apiErrors';

export interface PrivateFileState {
  url: string | null;
  error: string | null;
  loading: boolean;
}

const IDLE: PrivateFileState = { url: null, error: null, loading: false };

/**
 * One private rider-document page as an object URL (owner, 2026-10-10).
 * Fetched with the staff token, held only in memory, and revoked when the
 * page changes or the component unmounts - never written to storage.
 * `version` (the page's uploaded_at) refetches after a re-upload.
 */
export function useDocumentPage(documentId: string | null, page: number, version: string, enabled = true): PrivateFileState {
  const [state, setState] = useState<PrivateFileState>(IDLE);

  useEffect(() => {
    if (!documentId || !enabled) {
      setState(IDLE);
      return;
    }
    let live = true;
    let url: string | null = null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    setState({ url: null, error: null, loading: true });
    riderDocuments
      .page(documentId, page, controller?.signal)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setState({ url, error: null, loading: false });
      })
      .catch((err) => {
        if (live) setState({ url: null, error: errorMessage(err, 'Could not load this page.'), loading: false });
      });
    return () => {
      live = false;
      controller?.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId, page, version, enabled]);

  return state;
}
