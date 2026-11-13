"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminRequest, collectionPath } from "./api";

/** Keep confirmed edits visible even if a follow-up list request fails. */
export function useCollectionRows<Row extends { id: string }>(
  slug: string,
  pageSize: number,
  onError: (message: string) => void,
) {
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const activeRead = useRef<AbortController | null>(null);

  const cancelRead = useCallback(() => {
    activeRead.current?.abort();
    activeRead.current = null;
  }, []);

  const fetchPage = useCallback(async (targetPage: number) => {
    cancelRead();
    const controller = new AbortController();
    activeRead.current = controller;
    try {
      const result = await adminRequest<{ rows: Row[]; hasMore: boolean }>(
        `${collectionPath(slug)}?limit=${pageSize}&offset=${targetPage * pageSize}`,
        { signal: controller.signal },
      );
      // Aborting alone is not sufficient if a response already finished reading.
      if (controller.signal.aborted || activeRead.current !== controller) return;
      if (result.rows.length === 0 && targetPage > 0) {
        activeRead.current = null;
        setLoading(true);
        setPage(targetPage - 1);
        return;
      }
      setRows(result.rows);
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted && activeRead.current === controller) {
        onError(error instanceof Error ? error.message : "Could not refresh items.");
      }
    } finally {
      if (!controller.signal.aborted && activeRead.current === controller) setLoading(false);
    }
  }, [cancelRead, onError, pageSize, slug]);

  useEffect(() => {
    // State updates inside fetchPage happen only after the network request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage(page);
    return cancelRead;
  }, [cancelRead, fetchPage, page]);

  const goToPage = (nextPage: number) => {
    if (nextPage < 0 || nextPage === page) return;
    cancelRead();
    setLoading(true);
    onError("");
    setPage(nextPage);
  };

  const removeRow = (id: string) => {
    cancelRead();
    setRows((current) => current.filter((row) => row.id !== id));
    if (rows.length === 1 && page > 0) goToPage(page - 1);
    else void fetchPage(page);
  };

  const replaceRow = (row: Row) => {
    cancelRead();
    setRows((current) => current.map((item) => item.id === row.id ? row : item));
  };

  const insertRows = (newRows: Row[]) => {
    if (newRows.length === 0) return;
    cancelRead();
    if (page > 0) {
      setRows(newRows.slice(0, pageSize));
      setHasMore(newRows.length > pageSize);
      goToPage(0);
      return;
    }
    const ids = new Set(newRows.map((row) => row.id));
    setRows((current) => [...newRows, ...current.filter((item) => !ids.has(item.id))].slice(0, pageSize));
    if (rows.length + newRows.length > pageSize) setHasMore(true);
    void fetchPage(0);
  };

  return { rows, page, hasMore, loading, goToPage, removeRow, replaceRow, insertRows, insertRow: (row: Row) => insertRows([row]) };
}
