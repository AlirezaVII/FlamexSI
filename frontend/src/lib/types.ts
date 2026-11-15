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
  novelty: Novelty[];
  safety_areas: SafetyArea[];
  innovation_kinds: InnovationKind[];
  innovation_stages: InnovationStage[];
}

export interface Dataset {
  dataset_id: string;
  name: string;
  synthetic: boolean;
  created_at: string;
  n_rows: number;
  columns: string[];
  source_ids: string[];
  report: {
    tables: PipelineReport[];
    ingestion?: {
      source_id: string;
      filename: string;
      sha256: string;
      encoding?: string;
      adapter?: string;
      missing_markers?: string[];
    }[];
  };
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

export interface ReviewArtifact {
  key: string;
  filename: string;
  media_type: string;
  bytes: number;
  sha256: string;
}

export interface ReviewedFinding {
  review_id: number;
  condition: string;
  outcome: string;
  analyzer: string;
  n: number;
  primary_effect: number;
  primary_holdout_effect: number;
  primary_holdout_p: number;
  date_effect: number;
  date_holdout_effect: number;
  date_holdout_p: number;
  q_value_primary: number;
  review_decision: string;
  scope_and_limitation: string;
  formal_expert_approval: boolean;
  methanol_rho?: number;
  methanol_n?: number;
  heptane_rho?: number;
  heptane_n?: number;
}

export interface CompositionalModel {
  model_id: string;
  diluent: "CO2" | "He";
  outcome: "droplet_burning_rate_constant" | "extinction_diameter_ratio";
  scope: string;
  role: string;
  status: string;
  n: number;
  n_dates: number;
  n_parameters: number;
  design_rank: number;
  small_cluster_warning: boolean;
  beta_alternative: number;
  cluster_se: number;
  ci95_low: number;
  ci95_high: number;
  p_value: number;
  effect_per_alternative_n2_doubling: number;
  doubling_ci95_low: number;
  doubling_ci95_high: number;
  cluster_df: number;
  bh_q_value: number;
  prediction_n: number;
  n_folds: number;
  full_rmse: number;
  baseline_rmse: number;
  delta_rmse_full_minus_baseline: number;
  interpretation: string;
}

export interface TimeSeriesFit {
  series: "CO2" | "N2" | "He";
  window: string;
  role: "primary" | "sensitivity" | "near_extinction" | "descriptive_not_combustion";
  window_start_fraction: number | null;
  window_end_fraction: number | null;
  published_k_mm2_s: number | null;
  n: number;
  burning_rate_constant_mm2_s: number;
  rmse_mm2: number;
  r_squared: number;
  late_to_primary_k_ratio: number | null;
  late_k_reduction_fraction: number | null;
}

export interface ScientificReview {
  source: { filename: string; sha256: string; bytes: number };
  ingestion: {
    encoding: string;
    adapter: string;
    missing_markers: string[];
    approximate_burn_time_test_ids: string[];
    invalid_pressure_test_ids: string[];
    derived: Record<string, string>;
  };
  pipeline: {
    rows_in: number;
    rows_out: number;
    empty_rows_dropped: number;
    duplicate_rows_dropped: number;
    unit_conversions: {
      column: string;
      raw: string;
      from: string;
      to: string;
      values: number;
    }[];
    warnings: string[];
  };
  investigation: {
    accession: string;
    title: string;
    investigationAcronym: string;
    doi: string;
    version: number;
    licenseIdentifier: string;
    releaseDate: string;
    flightProgram: string;
    managingNasaCenter: string;
    experimentHardware: string;
  };
  scope: {
    review_type: string;
    official_report: {
      title: string;
      document_id: string;
      url: string;
      documented_setting: string;
      documented_series_size: number;
    };
    psi_table_audit: {
      rows: number;
      minimum_test_date: string;
      maximum_test_date: string;
      unique_test_dates: number;
    };
    numbering_evidence: { conclusion: string };
    environment_conclusion: {
      series_level_label: string;
      basis: string;
      limitation: string;
      per_row_labels_added: boolean;
    };
    campaign_conclusion: { limitation: string };
    partial_gravity_claim_allowed: boolean;
  };
  review: {
    review_type: string;
    formal_expert_approval: boolean;
    independent_external_validation: boolean;
    reviewed_findings: number;
    recommended_candidate_insight_themes: string[];
    findings: ReviewedFinding[];
  };
  replication: {
    investigation: string;
    acronym: string;
    doi: string;
    official_metadata_url: string;
    raw_rows: number;
    table_type: string;
    replication_executable: boolean;
    reason: string;
    inferential_tests_performed: number;
    protocol_lock: {
      protocol_version: string;
      protocol_sha256: string;
      external_registry_preregistration: boolean;
    };
  };
  uncertainty: {
    analysis_type: string;
    source: {
      authors: string;
      title: string;
      doi: string;
      url: string;
      typical_95_expanded_diameter_mm: number;
      typical_95_expanded_burning_rate_mm2_s: number;
    };
    scenario: {
      simulations: number;
      seed: number;
      oxygen_pressure_protocol_and_systematic_errors_included: boolean;
    };
    limitations: string[];
    residual_qc: {
      n: number;
      covered_by_expanded_scenario_share: number;
      interpretation: string;
    };
  };
  time_series: {
    analysis_type: string;
    raw_images_recovered: boolean;
    raw_per_test_d_t_histories_recovered: boolean;
    independent_replication: boolean;
    data_assimilation_executed: boolean;
    source: {
      authors: string;
      year: number;
      doi: string;
      figure: number;
      published_downsampling: string;
      pdf_sha256: string;
    };
    primary_fit: string;
    candidate_row_mapping: {
      status: string;
      basis: string;
      candidates: Record<string, number>;
    };
    limitations: string[];
    fits: TimeSeriesFit[];
  };
  compositional: {
    analysis_type: string;
    protocol_version: string;
    protocol_sha256: string;
    protocol_verified: boolean;
    external_registry_preregistration: boolean;
    causal_effects_established: boolean;
    full_protocol_control_established: boolean;
    independent_campaign_validation: boolean;
    primary_models: CompositionalModel[];
    structural_zero_policy: string;
    n2_only_policy: string;
    limitations: string[];
  };
  artifacts: ReviewArtifact[];
  finding_status_counts: Record<Status, number>;
  finding_total: number;
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
    groups_discovery?: number | null;
    groups_holdout?: number | null;
    shared_across_split?: Record<string, number>;
    test_fraction?: number | null;
    seed?: number | null;
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
  prior_knowledge: PriorKnowledge | null;
}

export type Novelty =
  "unreviewed" | "known" | "partly_known" | "new_conditions" | "possibly_new";

export interface Reference {
  title: string;
  url: string;
  kind: "nasa_primary" | "challenge" | "paper" | "other";
  note: string;
}

export interface PriorKnowledge {
  novelty: Novelty;
  summary: string;
  references: Reference[];
  reviewer: string;
  reviewed_at: string;
}

export interface SearchPlan {
  queries: { query: string; links: { site: string; url: string }[] }[];
  nasa_psi: string;
  provider: string;
  note: string;
}

export type SafetyArea =
  | "fire_behavior"
  | "risk_assessment"
  | "experiment_design"
  | "safety_decisions"
  | "combustion_management";

export type InnovationKind =
  | "indicator"
  | "detection_method"
  | "risk_map"
  | "warning_system"
  | "decision_tool"
  | "prediction_method"
  | "other";

export type InnovationStage =
  "idea" | "evaluating" | "building" | "prototype" | "demo" | "dropped";

export interface Innovation {
  innovation_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  kind: InnovationKind;
  enables: string;
  description: string;
  insight_ids: string[];
  proposed_by: string;
  stage: InnovationStage;
  decision_note: string;
}

export interface InnovationSuggestion {
  title: string;
  kind: InnovationKind;
  enables: string;
  rationale: string;
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
  limitations: string;
  safety_areas: SafetyArea[];
  related_finding_ids: string[];
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
  split_options: { column: string; label: string; groups: number }[];
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

export interface Showcase {
  synthetic: boolean;
  dataset: string;
  headline: string;
  status: Status;
  method: string;
  n_experiments: number;
  split: {
    discovery_experiments: number;
    holdout_experiments: number;
    by: string;
    shared_across_split: Record<string, number>;
  };
  discovery_effect: number;
  unseen_effect: number;
  shuffles_as_strong: number;
  permutations: number;
  effect_all_rows: number;
  controls: Record<string, { effect: number; retained_share: number }>;
  explained_by: string[];
  score: number;
  rank: number;
  of: number;
}

export type ChartValue = string | number | boolean | null;

export interface FindingChart {
  x: string;
  y: string;
  color_by: string | null;
  color_kind: "numeric" | "categorical" | null;
  points: {
    id: string;
    x: number;
    y: ChartValue;
    split: "discovery" | "holdout";
    color: ChartValue;
  }[];
  trend: {
    method: string;
    x: number[];
    y: (number | null)[];
    low: (number | null)[];
    high: (number | null)[];
  } | null;
  discovery_points: number;
  holdout_points: number;
  color_options: string[];
}

export interface FootageFrame {
  index: number;
  time_s: number | null;
  present: boolean;
  rejected?: string;
  image?: string;
  radius_px?: number;
  circularity?: number | null;
  aspect_ratio?: number | null;
  centroid?: [number, number] | null;
  bbox?: [number, number, number, number];
  contour?: [number, number][];
  blue_fraction?: number | null;
  soot_fraction?: number | null;
  saturated_fraction?: number | null;
  soot_to_blue?: number | null;
  heat_blue?: number[][];
  heat_soot?: number[][];
}

export interface FootageSummary {
  length_unit: "px" | "mm";
  flame_frames: number;
  frames: number;
  note?: string;
  circularity_median?: number | null;
  aspect_ratio_median?: number | null;
  blue_fraction_median?: number | null;
  soot_fraction_median?: number | null;
  saturated_fraction_median?: number | null;
  soot_to_blue_ratio?: number | null;
  max_radius?: number;
  extinguished_in_clip?: boolean;
  extinction_radius?: number;
  extinction_time_s?: number | null;
  growth_rate?: number;
  growth_rate_unit?: string;
  growth_fit_r2?: number | null;
  growth_frames?: number;
}

export interface FootageAnalysis {
  frame_size: [number, number];
  overlay_scale: number;
  frames_total: number;
  frames_analyzed: number;
  fps: number | null;
  fps_source: "override" | "file" | null;
  mm_per_px: number | null;
  summary: FootageSummary;
  frames: FootageFrame[];
  method: string;
  synthetic: boolean;
  source: Source & { synthetic?: boolean | null };
  analyzed_at: string;
}

export interface MediaItem {
  source: Source & { synthetic?: boolean | null };
  analyzed: boolean;
  kind: "video" | "image";
}

export interface FlammabilityMap {
  axis: "gravity" | "flow_rate";
  material: string | null;
  n: number;
  n_burned: number;
  predictors: string[];
  pressure_used: number | null;
  ranges: Record<string, [number, number]>;
  coefficients: Record<
    string,
    { per_sd: number; se: number; z: number | null }
  >;
  grid: {
    x: number[];
    oxygen: number[];
    p_burn: number[][];
    in_data: boolean[][];
  };
  boundary: { x: number; oxygen: number | null }[];
  point: {
    x: number;
    oxygen_limit_50: number | null;
    oxygen_limit_ci: [number, number] | null;
    oxygen: number | null;
    p_burn: number | null;
    p_burn_ci: [number, number] | null;
    extrapolation: string[];
  } | null;
  points: { x: number; oxygen: number; burned: boolean }[];
  method: string;
  synthetic: boolean;
  dataset: string;
  materials: string[];
  axes: string[];
}

export interface ReferenceLimit {
  limit_id: string;
  created_at: string;
  material: string;
  kind: string;
  oxygen_percent: number;
  pressure_kpa: number | null;
  gravity_g: number | null;
  flow_cm_s: number | null;
  source: string;
  url: string;
  note: string;
  entered_by: string;
}
