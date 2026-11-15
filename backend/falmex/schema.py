"""Canonical variable schema, loaded from YAML (see config/variables.yaml)."""

import re
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path

import yaml

DEFAULT_SCHEMA_PATH = Path(__file__).parent / "config" / "variables.yaml"


class Role(StrEnum):
    ID = "id"
    CONDITION = "condition"
    OUTCOME = "outcome"
    META = "meta"


class VarType(StrEnum):
    NUMERIC = "numeric"
    CATEGORICAL = "categorical"
    BOOLEAN = "boolean"
    TEXT = "text"


@dataclass(frozen=True)
class UnitConversion:
    scale: float = 1.0
    offset: float = 0.0

    def apply(self, value: float) -> float:
        return value * self.scale + self.offset


@dataclass(frozen=True)
class Variable:
    name: str
    role: Role
    type: VarType
    unit: str | None = None
    description: str = ""
    aliases: tuple[str, ...] = ()
    units: dict[str, UnitConversion] = field(default_factory=dict)
    safety_weight: float = 0.5


def normalize_name(name: str) -> str:
    """'Oxygen Concentration (%)' -> 'oxygen_concentration'."""
    name = re.sub(r"\(.*?\)|\[.*?\]", "", str(name))
    name = re.sub(r"[^0-9a-zA-Z]+", "_", name.strip().lower())
    return name.strip("_")


class Schema:
    def __init__(self, variables: dict[str, Variable]):
        self.variables = variables
        self._lookup: dict[str, str] = {}
        for var in variables.values():
            for key in (var.name, *var.aliases):
                self._lookup[normalize_name(key)] = var.name

    @classmethod
    def load(cls, path: Path | None = None) -> "Schema":
        raw = yaml.safe_load(Path(path or DEFAULT_SCHEMA_PATH).read_text())
        variables = {}
        for name, spec in (raw.get("variables") or {}).items():
            variables[name] = Variable(
                name=name,
                role=Role(spec["role"]),
                type=VarType(spec["type"]),
                unit=spec.get("unit"),
                description=spec.get("description", ""),
                aliases=tuple(spec.get("aliases", [])),
                units={u: UnitConversion(**c) for u, c in (spec.get("units") or {}).items()},
                safety_weight=float(spec.get("safety_weight", 0.5)),
            )
        return cls(variables)

    def resolve(self, column: str) -> str | None:
        """Return the canonical variable name for a raw column name, if known."""
        return self._lookup.get(normalize_name(column))

    def get(self, name: str) -> Variable | None:
        return self.variables.get(name)

    def by_role(self, role: Role) -> list[Variable]:
        return [v for v in self.variables.values() if v.role == role]

    @property
    def id_column(self) -> str | None:
        ids = self.by_role(Role.ID)
        return ids[0].name if ids else None
