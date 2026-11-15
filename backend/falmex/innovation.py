"""Innovation: the part of FlamexSI that goes beyond the challenge.

After the team reaches an insight about fire safety, it asks what new capability that
insight makes possible. The kind of innovation is deliberately not fixed in advance: it can
be an indicator, a detection method, a risk map, a warning system, a decision tool, a
prediction method, or something nobody thought of yet. It must come out of an insight, so
every innovation links to at least one. The AI may suggest directions; the team decides.

    insight -> innovation -> prototype -> demo
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class InnovationKind(StrEnum):
    INDICATOR = "indicator"  # a new index or metric
    DETECTION_METHOD = "detection_method"
    RISK_MAP = "risk_map"
    WARNING_SYSTEM = "warning_system"
    DECISION_TOOL = "decision_tool"
    PREDICTION_METHOD = "prediction_method"
    OTHER = "other"


class Stage(StrEnum):
    IDEA = "idea"
    EVALUATING = "evaluating"  # the team is judging whether it is worth building
    BUILDING = "building"
    PROTOTYPE = "prototype"
    DEMO = "demo"  # part of the final presentation
    DROPPED = "dropped"


class Innovation(BaseModel):
    innovation_id: str
    created_at: datetime
    updated_at: datetime
    title: str
    kind: InnovationKind
    enables: str  # the new capability the insight makes possible
    description: str
    insight_ids: list[str] = Field(min_length=1)  # innovation comes out of insights
    proposed_by: str
    stage: Stage = Stage.IDEA
    decision_note: str = ""  # why the team keeps, builds or drops it


class Suggestion(BaseModel):
    """An AI-suggested direction. Not saved and not a decision."""

    title: str
    kind: InnovationKind
    enables: str
    rationale: str
