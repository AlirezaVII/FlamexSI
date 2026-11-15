"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "./api";
import type { Dataset } from "./types";

interface Workspace {
  datasets: Dataset[];
  dataset: Dataset | null;
  selectDataset: (id: string) => void;
  refresh: () => Promise<void>;
  compareIds: string[];
  toggleCompare: (experimentId: string) => void;
  clearCompare: () => void;
  setCompare: (ids: string[]) => void;
  error: string | null;
  /** true until the dataset list has been fetched once */
  loading: boolean;
}

const Ctx = createContext<Workspace | null>(null);
const KEY = "falmex.dataset";

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.datasets();
      setDatasets(list);
      setError(null);
      setSelectedId((current) => {
        const wanted = current ?? readStored();
        return list.some((d) => d.dataset_id === wanted)
          ? wanted
          : (list[0]?.dataset_id ?? null);
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    refresh();
  }, [refresh]);

  const selectDataset = useCallback((id: string) => {
    setSelectedId(id);
    setCompareIds([]);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }, []);

  const toggleCompare = useCallback((experimentId: string) => {
    setCompareIds((ids) =>
      ids.includes(experimentId)
        ? ids.filter((i) => i !== experimentId)
        : [...ids, experimentId],
    );
  }, []);

  const value: Workspace = {
    datasets,
    dataset: datasets.find((d) => d.dataset_id === selectedId) ?? null,
    selectDataset,
    refresh,
    compareIds,
    toggleCompare,
    clearCompare: () => setCompareIds([]),
    setCompare: (ids: string[]) => setCompareIds(ids),
    error,
    loading,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
