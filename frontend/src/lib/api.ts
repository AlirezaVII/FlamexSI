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
  FootageComparison,
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
      "Cannot reach the FlamexSI server. Check your connection and try again.",
    );
  }
  if (!res.ok) {
    let detail =
      res.status === 413
        ? "The file is too large for the server."
        : res.status === 429
          ? "Too many requests. Please wait a minute and try again."
          : res.status === 504 || res.status === 502 || res.status === 503
            ? "The server did not respond in time. Please try again in a moment."
            : res.status >= 500
              ? "The server hit an unexpected error. Please try again; if it repeats, tell the team."
              : res.statusText || `Request failed (${res.status}).`;
    try {
      const body = await res.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : Array.isArray(body.detail)
            ? body.detail.map(readableIssue).join(" ")
            : detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

/**
 * Uploads. Files larger than CHUNKED_FROM go in pieces of the size the server asks for
 * (8 MB): each piece is its own short request, so no proxy limit applies (Cloudflare caps a
 * request at 100 MB and 100 s; Vercel at 120 s), a failed piece is retried alone, and the
 * server writes pieces to disk instead of holding the file in memory. Videos may be up to
 * 2 GB, tables up to 200 MB (they are read in memory).
 */
const CHUNKED_FROM = 8_000_000;
const MEDIA_EXT = /\.(mp4|avi|mov|png|jpe?g|tiff?)$/i;
export type UploadProgress = (sent: number, total: number) => void;
type UploadResult = { dataset: Dataset | null; source: Source; assets: unknown[] };

function checkUploadSize(file: File) {
  const media = MEDIA_EXT.test(file.name);
  const limit = media ? 2_000_000_000 : 200_000_000;
  if (file.size > limit)
    throw new ApiError(
      413,
      `${file.name} is ${(file.size / 1_000_000).toFixed(0)} MB; the limit is ${limit / 1_000_000} MB for ${media ? "videos and images" : "tables"}. ${media ? "Trim the video" : "Split the file or export only the needed columns"}.`,
    );
}

async function sendPiece(path: string, body: Blob, tries = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await send(path, { method: "PUT", body, headers: { "Content-Type": "application/octet-stream" } });
      return;
    } catch (e) {
      const status = (e as ApiError).status;
      // a refused piece (wrong size, unknown upload) will not get better by retrying
      if (attempt >= tries || (status >= 400 && status < 500 && status !== 429)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function uploadInPieces(
  file: File, extra: { name?: string; dataset_id?: string }, onProgress?: UploadProgress,
): Promise<UploadResult> {
  const start = await send<{ upload_id: string; chunk_bytes: number; chunks: number }>(
    "/api/uploads", json({ filename: file.name, size: file.size }));
  const base = `/api/uploads/${start.upload_id}`;
  try {
    for (let i = 0; i < start.chunks; i++) {
      const from = i * start.chunk_bytes;
      await sendPiece(`${base}/${i}`, file.slice(from, Math.min(file.size, from + start.chunk_bytes)));
      onProgress?.(Math.min(file.size, from + start.chunk_bytes), file.size);
    }
    return await send<UploadResult>(`${base}/complete`, json(extra));
  } catch (e) {
    send(base, { method: "DELETE" }).catch(() => {});
    throw e;
  }
}

function uploadFile(
  file: File, extra: { name?: string; dataset_id?: string }, onProgress?: UploadProgress,
  path = "/api/datasets",
): Promise<UploadResult> {
  checkUploadSize(file);
  if (file.size > CHUNKED_FROM) return progress.track(uploadInPieces(file, extra, onProgress));
  const form = new FormData();
  form.append("file", file);
  if (extra.name) form.append("name", extra.name);
  return request<UploadResult>(path, { method: "POST", body: form }).then((r) => {
    onProgress?.(file.size, file.size);
    return r;
  });
}

/** Start a background job and wait for it, asking every few seconds (no proxy time limit). */
export type JobTick = (status: string, elapsed: number) => void;
async function runJob<T>(startPath: string, body: unknown, onTick?: JobTick): Promise<T> {
  const { job_id } = await send<{ job_id: string }>(startPath, json(body));
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    let job: { status: string; result?: T; error?: string; code?: number; elapsed_s: number };
    try {
      job = await send(`/api/jobs/${job_id}`);
    } catch (e) {
      if ((e as ApiError).status === 0 && Date.now() - t0 < 30 * 60_000) continue; // blip
      throw e;
    }
    onTick?.(job.status, job.elapsed_s);
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new ApiError(job.code ?? 500, job.error ?? "The job failed.");
    if (Date.now() - t0 > 30 * 60_000) throw new ApiError(504, "The analysis is taking longer than 30 minutes; try a shorter clip.");
  }
}

/** A FastAPI/pydantic validation issue as a sentence a person can act on. */
function readableIssue(issue: {
  type?: string;
  loc?: (string | number)[];
  msg?: string;
  ctx?: {
    min_length?: number;
    max_length?: number;
    gt?: number;
    ge?: number;
    lt?: number;
    le?: number;
  };
}): string {
  const field = String(
    [...(issue.loc ?? [])].reverse().find((p) => typeof p === "string" && p !== "body") ??
      "a field",
  ).replace(/_/g, " ");
  const name = field.charAt(0).toUpperCase() + field.slice(1);
  const c = issue.ctx ?? {};
  if (issue.type === "string_pattern_mismatch")
    return field === "url"
      ? "Links must start with http:// or https://."
      : `${name} has an invalid format.`;
  if (c.gt !== undefined) return `${name} must be greater than ${c.gt}.`;
  if (c.ge !== undefined) return `${name} must be at least ${c.ge}.`;
  if (c.lt !== undefined) return `${name} must be less than ${c.lt}.`;
  if (c.le !== undefined) return `${name} must be at most ${c.le}.`;
  if (issue.type === "json_invalid") return "The request was not valid JSON.";
  if (issue.type?.endsWith("_parsing") || issue.type?.endsWith("_type"))
    return `${name} has the wrong kind of value (for example text where a number is expected).`;
  if (issue.type === "enum" || issue.type === "literal_error")
    return `${name} is not one of the allowed options.`;
  if (issue.ctx?.min_length !== undefined)
    return `${name} needs at least ${issue.ctx.min_length} characters.`;
  if (issue.ctx?.max_length !== undefined)
    return `${name} can be at most ${issue.ctx.max_length} characters.`;
  if (issue.msg === "Field required") return `${name} is required.`;
  return `${name}: ${issue.msg ?? "invalid value"}.`;
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
  upload: (file: File, name?: string, onProgress?: UploadProgress) =>
    uploadFile(file, { name }, onProgress),
  loadFlex: () =>
    request<{ dataset: Dataset }>("/api/datasets/nasa/flex", { method: "POST" }),
  deleteDataset: (id: string) =>
    request<null>(`/api/datasets/${id}`, { method: "DELETE" }),
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
  addSource: (id: string, file: File, onProgress?: UploadProgress) =>
    uploadFile(file, { dataset_id: id }, onProgress, `/api/datasets/${id}/sources`),
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
  uploadMedia: (file: File, onProgress?: UploadProgress) =>
    uploadFile(file, {}, onProgress),
  analyzeMedia: (
    id: string,
    body: { fps?: number | null; mm_per_px?: number | null; detector?: string },
  ) => request<FootageAnalysis>(`/api/media/${id}/analyze`, json(body)),
  compareMedia: (id: string, body: { fps?: number | null; mm_per_px?: number | null; detectors?: string[] }) =>
    request<FootageComparison>(`/api/media/${id}/compare`, json(body)),
  /** The same as analyzeMedia / compareMedia, as background jobs (long videos). */
  analyzeMediaJob: (
    id: string,
    body: { fps?: number | null; mm_per_px?: number | null; detector?: string },
    onTick?: JobTick,
  ) => progress.track(runJob<FootageAnalysis>(`/api/media/${id}/analyze/start`, body, onTick)),
  compareMediaJob: (
    id: string,
    body: { fps?: number | null; mm_per_px?: number | null; detectors?: string[] },
    onTick?: JobTick,
  ) => progress.track(runJob<FootageComparison>(`/api/media/${id}/compare/start`, body, onTick)),
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
