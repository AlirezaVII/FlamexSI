"""File readers ("adapters").

Each adapter turns one file into tables and/or media assets. Adding support
for a new NASA format (images, video, HDF5, ...) means registering one more
adapter — nothing downstream changes.
"""

import io
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd


class UnsupportedFileError(ValueError):
    pass


@dataclass
class RawTable:
    name: str
    frame: pd.DataFrame


@dataclass
class MediaAsset:
    """Placeholder for non-tabular data (images, video). Not analyzed yet."""

    name: str
    media_type: str
    size_bytes: int


@dataclass
class IngestResult:
    tables: list[RawTable] = field(default_factory=list)
    assets: list[MediaAsset] = field(default_factory=list)
    # Adapter decisions (encoding, value cleaning, derived fields) are persisted
    # in the dataset report by the upload workflow.
    metadata: dict = field(default_factory=dict)


Adapter = Callable[[str, bytes], IngestResult]
_ADAPTERS: dict[str, Adapter] = {}


def register(*extensions: str) -> Callable[[Adapter], Adapter]:
    def wrap(fn: Adapter) -> Adapter:
        for ext in extensions:
            _ADAPTERS[ext.lower()] = fn
        return fn

    return wrap


def supported_extensions() -> list[str]:
    return sorted(_ADAPTERS)


def read_file(filename: str, content: bytes) -> IngestResult:
    ext = Path(filename).suffix.lower().lstrip(".")
    adapter = _ADAPTERS.get(ext)
    if adapter is None:
        raise UnsupportedFileError(
            f"Unsupported file type '.{ext}'. Supported: {', '.join(supported_extensions())}"
        )
    return adapter(filename, content)


@register("csv")
def _read_csv(filename: str, content: bytes) -> IngestResult:
    # PSI exports are not uniformly UTF-8. FLEX v5, for example, contains CP1252
    # en-dashes as explicit missing-value markers. Try strict decodings in order;
    # never silently replace unrecognised bytes.
    last_error: UnicodeDecodeError | None = None
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError as exc:
            last_error = exc
    else:  # pragma: no cover - the final exception is the useful diagnostic
        raise last_error  # type: ignore[misc]

    frame = pd.read_csv(io.StringIO(text), sep=None, engine="python")
    metadata: dict = {"encoding": encoding}
    from falmex.ingest.flex import is_flex_table, prepare_flex

    if is_flex_table(frame):
        frame, flex_metadata = prepare_flex(frame)
        metadata.update(flex_metadata)
    return IngestResult(tables=[RawTable(Path(filename).stem, frame)], metadata=metadata)


@register("tsv", "txt")
def _read_tsv(filename: str, content: bytes) -> IngestResult:
    frame = pd.read_csv(io.BytesIO(content), sep="\t")
    return IngestResult(tables=[RawTable(Path(filename).stem, frame)])


@register("xlsx", "xls")
def _read_excel(filename: str, content: bytes) -> IngestResult:
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None)
    return IngestResult(tables=[RawTable(name, df) for name, df in sheets.items()])


@register("json")
def _read_json(filename: str, content: bytes) -> IngestResult:
    data = json.loads(content)
    if isinstance(data, dict):
        # {"experiments": [...]} or a single record
        records = next((v for v in data.values() if isinstance(v, list)), [data])
    else:
        records = data
    frame = pd.json_normalize(records)
    return IngestResult(tables=[RawTable(Path(filename).stem, frame)])


@register("parquet")
def _read_parquet(filename: str, content: bytes) -> IngestResult:
    frame = pd.read_parquet(io.BytesIO(content))
    return IngestResult(tables=[RawTable(Path(filename).stem, frame)])


def _media_adapter(media_type: str) -> Adapter:
    def read(filename: str, content: bytes) -> IngestResult:
        return IngestResult(assets=[MediaAsset(filename, media_type, len(content))])

    return read


for _ext in ("png", "jpg", "jpeg", "tif", "tiff"):
    register(_ext)(_media_adapter("image"))
for _ext in ("mp4", "avi", "mov"):
    register(_ext)(_media_adapter("video"))
