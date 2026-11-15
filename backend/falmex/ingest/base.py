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


def _decode(content: bytes) -> tuple[str, str]:
    """PSI exports are not uniformly UTF-8. FLEX v5, for example, contains CP1252
    en-dashes as explicit missing-value markers. Try strict decodings in order;
    never silently replace unrecognised bytes."""
    last_error: UnicodeDecodeError | None = None
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return content.decode(encoding), encoding
        except UnicodeDecodeError as exc:
            last_error = exc
    raise last_error  # type: ignore[misc]  # pragma: no cover


_DELIMITERS = (",", "\t", ";", "|")


def _layout(lines: list[str]) -> tuple[str, int]:
    """Find the delimiter and the header row of a delimited text export.

    Instrument logs often start with a few free-text lines (a reference time stamp, a
    unit note) before the real header. The header is the first line whose field count
    matches the field count of the data lines that follow it.
    """
    body = [ln for ln in lines if ln.strip()][:200]
    best: tuple[int, str, int] | None = None  # (data lines that agree, delimiter, header)
    for delim in _DELIMITERS:
        counts = [ln.count(delim) for ln in body]
        if not any(counts):
            continue
        for start in range(min(15, len(body))):
            tail = counts[start + 1 : start + 41]
            if not tail or counts[start] == 0:
                continue
            modal = max(set(tail), key=tail.count)
            agree = sum(c == modal for c in tail)
            if counts[start] == modal and agree >= max(1, int(0.8 * len(tail))):
                if best is None or agree > best[0]:
                    best = (agree, delim, start)
                break
    if best is None:
        return ",", 0
    _, delim, start = best
    header = body[start]
    return delim, lines.index(header)


def _read_delimited(filename: str, content: bytes) -> IngestResult:
    text, encoding = _decode(content)
    lines = text.splitlines()
    delim, header = _layout(lines)
    frame = pd.read_csv(
        io.StringIO("\n".join(lines[header:])), sep=delim, skipinitialspace=True,
        engine="python",
    )
    frame.columns = [str(c).strip() for c in frame.columns]
    metadata: dict = {"encoding": encoding, "delimiter": delim}
    if header:
        metadata["preamble"] = [ln for ln in lines[:header] if ln.strip()]
    if frame.shape[1] == 1 and len(lines) > 2 and any(d in lines[header] for d in ",;|\t"):
        raise ValueError(
            f"{filename}: could not split the columns (one column only); check the delimiter"
        )
    from falmex.ingest.flex import is_flex_table, prepare_flex

    if is_flex_table(frame):
        frame, flex_metadata = prepare_flex(frame)
        metadata.update(flex_metadata)
    return IngestResult(tables=[RawTable(Path(filename).stem, frame)], metadata=metadata)


register("csv", "tsv", "txt")(_read_delimited)


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
