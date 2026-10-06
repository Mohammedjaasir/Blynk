import { useCallback, useRef } from 'react';
import { deleteImage } from '../api/client';

/**
 * Which stored files a successful save has made unused: the ones the record
 * pointed at before (`original`) or that were uploaded while editing
 * (`uploaded`), minus whatever the saved record now points at (`saved`).
 */
export function imagesToDelete(
  original: ReadonlyArray<string | null | undefined>,
  saved: ReadonlyArray<string | null | undefined>,
  uploaded: ReadonlyArray<string> = []
): string[] {
  const keep = new Set(saved.filter((url): url is string => Boolean(url)));
  const candidates = [...original, ...uploaded].filter((url): url is string => Boolean(url));
  return [...new Set(candidates)].filter((url) => !keep.has(url));
}

/**
 * Deferred image deletion for a form. Removing or replacing an image only
 * changes the field; the old file is deleted only after the form has been
 * saved successfully without it. A failed save, or Cancel, deletes nothing,
 * so the record keeps a working image.
 *
 * Files uploaded in this session and abandoned by Cancel stay on the server
 * (never referenced) - deleting them is not worth risking a save whose
 * response was lost but which did land.
 */
export function useImageCleanup(original: ReadonlyArray<string | null | undefined>) {
  const originalRef = useRef(original);
  originalRef.current = original;
  const uploaded = useRef(new Set<string>());

  /** Note every URL the uploader hands back, so a replaced upload is cleaned too. */
  const track = useCallback((url: string | null | undefined) => {
    if (url) uploaded.current.add(url);
  }, []);

  /** Call only after the save succeeded, with the URLs the saved record uses. */
  const afterSave = useCallback(async (saved: ReadonlyArray<string | null | undefined>) => {
    const urls = imagesToDelete(originalRef.current, saved, [...uploaded.current]);
    uploaded.current.clear();
    await Promise.all(
      urls.map((url) =>
        deleteImage(url).catch(() => {
          // The record is saved either way; a leftover file is not worth an error.
        })
      )
    );
  }, []);

  return { track, afterSave };
}
