import type {
  Dataset,
  DatasetDetail,
  DiscoverResult,
  Filter,
  Finding,
  Meta,
  Row,
  Source,
  Status,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(0, `Cannot reach the Falmex API at ${API_URL}. Is the backend running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () =>
    request<{ status: string; version: string; llm: { provider: string; model: string } }>(
      "/health",
    ),
  meta: () => request<Meta>("/api/meta"),

  datasets: () => request<Dataset[]>("/api/datasets"),
  dataset: (id: string) => request<DatasetDetail>(`/api/datasets/${id}`),
  upload: (file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    return request<{ dataset: Dataset | null; source: Source; assets: unknown[] }>(
      "/api/datasets",
      { method: "POST", body: form },
    );
  },
  createSynthetic: (n_experiments = 200, seed = 0) =>
    request<{ dataset: Dataset }>("/api/datasets/synthetic", json({ n_experiments, seed })),

  query: (
    id: string,
    body: { filters?: Filter[]; limit?: number; offset?: number; sort?: string; descending?: boolean },
  ) =>
    request<{ rows: Row[]; total: number; limit: number; offset: number }>(
      `/api/datasets/${id}/query`,
      json(body),
    ),
  experiment: (id: string, experimentId: string) =>
    request<{
      experiment_id: string;
      rows: Row[];
      findings: { finding_id: string; headline: string; status: Status }[];
    }>(`/api/datasets/${id}/experiments/${encodeURIComponent(experimentId)}`),
  compare: (id: string, experiment_ids: string[]) =>
    request<{ experiments: Row[] }>(`/api/datasets/${id}/compare`, json({ experiment_ids })),

  discover: (id: string, body: { outcomes?: string[] } = {}) =>
    request<DiscoverResult>(`/api/datasets/${id}/discover`, json(body)),
  findings: (params: { dataset_id?: string; status?: Status; outcome?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    );
    return request<Finding[]>(`/api/findings?${qs}`);
  },
  finding: (id: string) => request<Finding>(`/api/findings/${id}`),
  interpret: (id: string, force = false) =>
    request<Finding>(`/api/findings/${id}/interpret?force=${force}`, { method: "POST" }),
  summary: (id: string) =>
    request<{ summary: string; caveats: string[]; provider: string; model: string }>(
      `/api/datasets/${id}/summary`,
    ),
};

export const label = (name: string) => name.replaceAll("_", " ");

export function fmt(v: unknown, digits = 3): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2);
    return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/\.?0+$/, "");
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
