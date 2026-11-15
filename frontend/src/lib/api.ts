import { progress } from "./progress";
import type {
  CompareResult,
  Dataset,
  DatasetDetail,
  DeepSuggestion,
  DiscoverResult,
  Filter,
  Finding,
  FindingChart,
  FlammabilityMap,
  FootageAnalysis,
  Goals,
  MediaItem,
  ReferenceLimit,
  Innovation,
  InnovationKind,
  InnovationStage,
  InnovationSuggestion,
  Insight,
  Meta,
  Novelty,
  PriorKnowledge,
  Reference,
  SafetyArea,
  SearchPlan,
  ScientificReview,
  ProbeResult,
  Quality,
  Row,
  Showcase,
  Source,
  Status,
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return progress.track(send<T>(path, init));
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(
      0,
      `Cannot reach the Falmex API at ${API_URL}. Is the backend running?`,
    );
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail);
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
    request<{
      status: string;
      version: string;
      llm: { provider: string; model: string };
    }>("/health"),
  meta: () => request<Meta>("/api/meta"),

  datasets: () => request<Dataset[]>("/api/datasets"),
  dataset: (id: string) => request<DatasetDetail>(`/api/datasets/${id}`),
  scientificReview: (id: string) =>
    request<ScientificReview>(`/api/datasets/${id}/scientific-review`),
  scientificArtifactUrl: (id: string, key: string) =>
    `${API_URL}/api/datasets/${id}/scientific-review/artifacts/${key}`,
  upload: (file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    return request<{
      dataset: Dataset | null;
      source: Source;
      assets: unknown[];
    }>("/api/datasets", { method: "POST", body: form });
  },
  createSynthetic: (n_experiments = 200, seed = 0) =>
    request<{ dataset: Dataset }>(
      "/api/datasets/synthetic",
      json({ n_experiments, seed }),
    ),

  query: (
    id: string,
    body: {
      filters?: Filter[];
      limit?: number;
      offset?: number;
      sort?: string;
      descending?: boolean;
    },
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
    request<CompareResult>(
      `/api/datasets/${id}/compare`,
      json({ experiment_ids }),
    ),
  quality: (id: string) => request<Quality>(`/api/datasets/${id}/quality`),
  addSource: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ dataset: Dataset | null; source: Source }>(
      `/api/datasets/${id}/sources`,
      { method: "POST", body: form },
    );
  },
  goals: (id: string) => request<Goals>(`/api/datasets/${id}/goals`),

  discover: (
    id: string,
    body: {
      goal?: string;
      outcomes?: string[];
      conditions?: string[];
      extra_outcomes?: string[];
      extra_conditions?: string[];
      split_by?: string;
    } = {},
  ) => request<DiscoverResult>(`/api/datasets/${id}/discover`, json(body)),
  deep: (id: string) =>
    request<{ finding_id: string; suggestions: DeepSuggestion[] }>(
      `/api/findings/${id}/deep`,
    ),
  runProbe: (id: string, probe: string, params: Record<string, string>) =>
    request<ProbeResult>(`/api/findings/${id}/deep`, json({ probe, params })),
  promote: (
    id: string,
    body: {
      statement: string;
      scientific_interpretation: string;
      fire_safety_relevance: string;
      reviewer: string;
      references: string[];
      limitations?: string;
      safety_areas?: SafetyArea[];
      related_finding_ids?: string[];
    },
  ) => request<Insight>(`/api/findings/${id}/insight`, json(body)),
  insights: () => request<Insight[]>("/api/insights"),

  searchPriorKnowledge: (id: string) =>
    request<SearchPlan>(`/api/findings/${id}/prior-knowledge/search`, {
      method: "POST",
    }),
  savePriorKnowledge: (
    id: string,
    body: {
      novelty: Novelty;
      summary: string;
      references: Reference[];
      reviewer: string;
    },
  ) =>
    request<Finding & { prior_knowledge: PriorKnowledge }>(
      `/api/findings/${id}/prior-knowledge`,
      { ...json(body), method: "PUT" },
    ),

  innovations: () => request<Innovation[]>("/api/innovations"),
  suggestInnovations: (insightId: string) =>
    request<{ insight_id: string; suggestions: InnovationSuggestion[] }>(
      `/api/insights/${insightId}/innovation-suggestions`,
      { method: "POST" },
    ),
  createInnovation: (body: {
    title: string;
    kind: InnovationKind;
    enables: string;
    description: string;
    insight_ids: string[];
    proposed_by: string;
  }) => request<Innovation>("/api/innovations", json(body)),
  updateInnovation: (
    id: string,
    body: { stage?: InnovationStage; decision_note?: string },
  ) =>
    request<Innovation>(`/api/innovations/${id}`, {
      ...json(body),
      method: "PATCH",
    }),
  showcase: () => request<Showcase>("/api/showcase"),
  findings: (params: {
    dataset_id?: string;
    status?: Status;
    outcome?: string;
  }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    );
    return request<Finding[]>(`/api/findings?${qs}`);
  },
  finding: (id: string) => request<Finding>(`/api/findings/${id}`),
  interpret: (id: string, force = false) =>
    request<Finding>(`/api/findings/${id}/interpret?force=${force}`, {
      method: "POST",
    }),
  findingChart: (id: string, colorBy?: string) =>
    request<FindingChart>(
      `/api/findings/${id}/chart${colorBy ? `?color_by=${encodeURIComponent(colorBy)}` : ""}`,
    ),

  media: () => request<MediaItem[]>("/api/media"),
  syntheticMedia: () =>
    request<{ source: Source }>("/api/media/synthetic", { method: "POST" }),
  uploadMedia: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ dataset: Dataset | null; source: Source }>(
      "/api/datasets",
      { method: "POST", body: form },
    );
  },
  analyzeMedia: (
    id: string,
    body: { fps?: number | null; mm_per_px?: number | null },
  ) => request<FootageAnalysis>(`/api/media/${id}/analyze`, json(body)),
  mediaAnalysis: (id: string) =>
    request<FootageAnalysis>(`/api/media/${id}/analysis`),
  mediaFrameUrl: (id: string, name: string) =>
    `${API_URL}/api/media/${id}/frames/${name}`,
  attachMedia: (id: string, dataset_id: string, experiment_id: string) =>
    request<{
      written: Record<string, number>;
      skipped: string[];
      note: string | null;
    }>(`/api/media/${id}/attach`, json({ dataset_id, experiment_id })),

  flammability: (
    id: string,
    body: {
      axis: string;
      material?: string | null;
      pressure?: number | null;
      at_x?: number | null;
      at_oxygen?: number | null;
    },
  ) => request<FlammabilityMap>(`/api/datasets/${id}/flammability`, json(body)),
  referenceLimits: () => request<ReferenceLimit[]>("/api/reference-limits"),
  addReferenceLimit: (body: Omit<ReferenceLimit, "limit_id" | "created_at">) =>
    request<ReferenceLimit>("/api/reference-limits", json(body)),
  deleteReferenceLimit: (id: string) =>
    progress.track(
      fetch(`${API_URL}/api/reference-limits/${id}`, { method: "DELETE" }).then(
        (r) => {
          if (!r.ok && r.status !== 404)
            throw new ApiError(r.status, r.statusText);
        },
      ),
    ),

  summary: (id: string) =>
    request<{
      summary: string;
      caveats: string[];
      provider: string;
      model: string;
    }>(`/api/datasets/${id}/summary`),
};

export const label = (name: string) => name.replaceAll("_", " ");

export function fmt(v: unknown, digits = 3): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2);
    return Number.isInteger(v)
      ? String(v)
      : v.toFixed(digits).replace(/\.?0+$/, "");
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
