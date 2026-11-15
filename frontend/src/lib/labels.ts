import type { InnovationKind, InnovationStage, SafetyArea } from "./types";

export const SAFETY_AREAS: Record<SafetyArea, string> = {
  fire_behavior: "Understanding fire behavior",
  risk_assessment: "Risk assessment",
  experiment_design: "Experiment design",
  safety_decisions: "Safety decisions",
  combustion_management: "Managing combustion conditions",
};

export const INNOVATION_KINDS: Record<InnovationKind, string> = {
  indicator: "New indicator",
  detection_method: "Detection method",
  risk_map: "Risk map",
  warning_system: "Warning system",
  decision_tool: "Decision tool",
  prediction_method: "Prediction method",
  other: "Something else",
};

export const STAGES: Record<InnovationStage, string> = {
  idea: "Idea",
  evaluating: "Evaluating",
  building: "Building",
  prototype: "Prototype",
  demo: "In the demo",
  dropped: "Dropped",
};
