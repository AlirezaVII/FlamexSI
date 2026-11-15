// Mirrors the backend models (backend/falmex/*.py).

export type Status = "validated" | "candidate" | "rejected" | "not_significant";

export interface Variable {
  name: string;
  role: "id" | "condition" | "outcome" | "meta";
  type: "numeric" | "categorical" | "boolean" | "text";
  unit: string | null;
  description: string;
}

export interface Meta {
  variables: Variable[];
  analyzers: { name: string; description: string }[];
  validators: { name: string; description: string }[];
  file_types: string[];
}

export interface Dataset {
  dataset_id: string;
  name: string;
  synthetic: boolean;
  created_at: string;
  n_rows: number;
  columns: string[];
  source_ids: string[];
  report: { tables: PipelineReport[] };
}

export interface PipelineReport {
  table: string;
  rows_in: number;
  rows_out: number;
  empty_rows_dropped: number;
  duplicate_rows_dropped: number;
  columns: { raw: string; canonical: string; known: boolean; unit_from: string | null }[];
  coercion_failures: Record<string, number>;
  warnings: string[];
}

export interface Source {
  source_id: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
  ingested_at: string;
}

export interface ColumnStats {
  name: string;
  known: boolean;
  role: Variable["role"] | null;
  type: string;
  unit: string | null;
  count: number;
  missing: number;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  top_values?: Record<string, number>;
}

export interface DatasetDetail {
  dataset: Dataset;
  columns: ColumnStats[];
  sources: Source[];
}

export type Row = Record<string, string | number | boolean | null>;

export interface Filter {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
  value: unknown;
}

export interface Validation {
  method: string;
  passed: boolean | null;
  message: string;
  metrics: Record<string, number>;
}

export interface Interpretation {
  summary: string;
  interpretation: string;
  safety_insight: string;
  caveats: string[];
  provider: string;
  model: string;
  generated_at: string;
}

export interface Finding {
  finding_id: string;
  dataset_id: string;
  created_at: string;
  synthetic: boolean;
  condition: string;
  outcome: string;
  analyzer: string;
  method: string;
  headline: string;
  effect_metric: string;
  effect_size: number;
  direction: string;
  p_value: number;
  q_value: number;
  n_train: number;
  details: Record<string, unknown>;
  validations: Validation[];
  status: Status;
  score: number;
  score_components: Record<string, number>;
  evidence: {
    n_rows: number;
    n_experiments: number;
    experiment_ids: string[];
    truncated: boolean;
    sources: { source_id: string; filename: string; sha256: string }[];
  };
  interpretation: Interpretation | null;
}

export interface DiscoverResult {
  dataset_id: string;
  tested: number;
  by_status: Record<Status, number>;
  findings: Finding[];
}
