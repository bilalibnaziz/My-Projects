// A small render of the open document for panel previews (layout thumbnails, look suggestions), made
// only once editing pauses: the panel never re-renders the whole document while you paint or drag.
import { useEffect, useState } from 'react';
import { store } from '../core/store';
import { lookSource } from '../core/lookOps';

export function useDeferredSource(key: string, maxSide: number, delay = 280): HTMLCanvasElement | null {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const doc = store.doc;
    if (!doc) {
      setSrc(null);
      return;
    }
    // The first preview comes right away; later ones wait for a pause
    const id = setTimeout(() => {
      const d = store.doc;
      if (d) setSrc(lookSource(d, maxSide));
    }, src ? delay : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, maxSide]);
  return src;
}
