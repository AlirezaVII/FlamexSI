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
  probes: { name: string; category: string; description: string }[];
  ranking_weights: Record<string, number>;
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
  columns: {
    raw: string;
    canonical: string;
    known: boolean;
    unit_from: string | null;
  }[];
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
  safety_relevance: string;
  caveats: string[];
  provider: string;
  model: string;
  generated_at: string;
}

export interface ProbeResult {
  probe: string;
  category: string;
  question: string;
  params: Record<string, string>;
  verdict: "supports" | "weakens" | "inconclusive" | "not_run";
  summary: string;
  metrics: Record<string, number>;
  rows: Record<string, string | number | null>[];
  ran_at: string | null;
}

export interface DeepSuggestion {
  probe: string;
  category: string;
  question: string;
  params: Record<string, string>;
  result: ProbeResult | null;
}

export interface Finding {
  finding_id: string;
  dataset_id: string;
  created_at: string;
  synthetic: boolean;
  goal: string;
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
  split: {
    discovery_rows: number;
    discovery_experiments: number;
    holdout_rows: number;
    holdout_experiments: number;
    by: string;
  } | null;
  validations: Validation[];
  uncertainty: {
    method: string;
    level: number;
    low: number;
    high: number;
    resamples: number;
    stable_share: number;
  } | null;
  status: Status;
  status_explanation: string;
  score: number;
  score_components: Record<string, number>;
  score_weights: Record<string, number>;
  evidence: {
    n_rows: number;
    n_experiments: number;
    experiment_ids: string[];
    truncated: boolean;
    sources: { source_id: string; filename: string; sha256: string }[];
  };
  limitations: string[];
  deep: ProbeResult[];
  interpretation: Interpretation | null;
}

export interface Insight {
  insight_id: string;
  finding_id: string;
  dataset_id: string;
  created_at: string;
  statement: string;
  scientific_interpretation: string;
  fire_safety_relevance: string;
  reviewer: string;
  references: string[];
  finding_snapshot: Finding;
}

export interface DiscoveryGoal {
  id: string;
  kind: "open" | "outcome" | "unmapped";
  question: string;
  description: string;
  outcomes: string[];
  extra_outcomes: string[];
}

export interface Goals {
  goals: DiscoveryGoal[];
  conditions: { mapped: string[]; unmapped: string[] };
}

export interface QualityVariable {
  name: string;
  group: "condition" | "outcome" | "other" | "unmapped";
  mapped: boolean;
  type: string;
  unit: string | null;
  converted_from: string | null;
  completeness: number;
  missing: number;
  invalid_values: number;
  outliers_flagged: number;
  usable: boolean;
  problem: string | null;
}

export interface Quality {
  synthetic: boolean;
  rows_in: number;
  rows_out: number;
  rows_removed: Record<string, number>;
  missing_cell_share: number;
  duplicate_row_share: number;
  unit_conversions: {
    column: string;
    raw: string;
    from: string;
    to: string;
    values: number;
  }[];
  invalid_values_set_missing: number;
  outliers_flagged: number;
  variables_mapped: number;
  variables_unmapped: number;
  variables_usable: number;
  experiments: number;
  experiments_with_repeated_measurements: number;
  sources: number;
  variables: QualityVariable[];
}

export type VarGroup = "condition" | "outcome" | "other";

export interface CompareVariable {
  name: string;
  group: VarGroup;
  unit: string | null;
  type: string;
  kind: "numeric" | "categorical";
  differs: boolean;
  dataset_range?: number;
  values: Record<
    string,
    {
      n: number;
      mean?: number;
      min?: number;
      max?: number;
      std?: number | null;
      values?: string[];
    }
  >;
}

export interface CompareResult {
  experiments: string[];
  missing: string[];
  variables: CompareVariable[];
  similar_conditions_different_outcomes: {
    a: string;
    b: string;
    conditions_compared: number;
    outcome_differences: { name: string; a: unknown; b: unknown }[];
  }[];
}

export interface DiscoverResult {
  dataset_id: string;
  tested: number;
  by_status: Record<Status, number>;
  findings: Finding[];
}
