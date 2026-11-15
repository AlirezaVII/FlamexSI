"""Delimited text exports as NASA PSI ships them (FLEX-2 raw files, PSI-68)."""

import pytest

from falmex.ingest.base import read_file


def test_quoted_comma_txt_is_split_into_columns():
    content = (
        b'"FCU TimeStamp","FCU_MP_PT16(PSIA)","FCU_MP_TM1(Deg C)"\n'
        b'"12/22/2014 15:30:03",14.70,22.1\n'
        b'"12/22/2014 15:30:04",14.71,22.2\n'
    )
    table = read_file("D356D06_Chamber_Readings.txt", content).tables[0].frame
    assert list(table.columns) == ["FCU TimeStamp", "FCU_MP_PT16(PSIA)", "FCU_MP_TM1(Deg C)"]
    assert table["FCU_MP_PT16(PSIA)"].tolist() == [14.70, 14.71]


def test_free_text_preamble_before_header_is_skipped_and_kept():
    content = (
        b"Reference Time Stamp 12/22/2014 15:30:03.741846\n"
        b"Milliseconds 16538215\n"
        b"ImgNum, DiskNum, Mseconds,       FileName\n"
        b"     0,       0, 16780880, D356D06B_00000\n"
        b"     1,       1, 16780913, D356D06B_00001\n"
        b"     2,       0, 16780947, D356D06B_00002\n"
    )
    result = read_file("D356D06B.txt", content)
    table = result.tables[0].frame
    assert list(table.columns) == ["ImgNum", "DiskNum", "Mseconds", "FileName"]
    assert len(table) == 3
    assert result.metadata["preamble"][0].startswith("Reference Time Stamp")


def test_tab_separated_still_works():
    table = read_file("x.tsv", b"a\tb\n1\t2\n3\t4\n").tables[0].frame
    assert list(table.columns) == ["a", "b"] and len(table) == 2


def test_unsplittable_delimited_text_is_an_error_not_a_silent_success():
    with pytest.raises(ValueError):
        read_file("bad.txt", b'"a,b,c"\n"1,2,3"\n"4,5,6"\n')
