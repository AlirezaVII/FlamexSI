"""Ask FlamexSI: streamed stages, chosen evidence, citation checks, input validation."""

import json

import pytest

from falmex import assistant


def _events(res):
    return [json.loads(line) for line in res.text.splitlines() if line.strip()]


def _ask(client, **body):
    return client.post("/api/assistant/ask", json={"question": "How reliable is it?", **body})


def test_stream_has_real_stages_in_order(client):
    res = _ask(client, question="Why does the ISS smoke detector read Kapton smoke weakly?")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/x-ndjson")
    ev = _events(res)
    kinds = [e["type"] for e in ev]
    assert kinds[0] == "stage" and ev[0]["stage"] == "think"
    assert kinds[-1] == "done"
    stages = [e["stage"] for e in ev if e["type"] == "stage"]
    assert stages.index("read") < stages.index("analyse") < stages.index("compose") \
        < stages.index("verify")
    sources = next(e for e in ev if e["type"] == "sources")["sources"]
    ids = [x["id"] for x in sources]
    assert ids[0] == "tool-smoke_by_material", "the chart it drew is the first source"
    assert "smoke" in ids, "and the smoke card is read too"
    tool = next(e for e in ev if e["type"] == "tool")
    assert tool["result"]["kind"] == "bars" and tool["result"]["rows"]
    assert any(s["id"] == "limits" for s in sources), "limits always come along"
    text = "".join(e["text"] for e in ev if e["type"] == "delta")
    assert "[S1]" in text
    done = ev[-1]
    assert done["cited"] == [1] and done["invalid"] == [] and done["followups"]


def test_a_smoke_question_finds_the_smoke_card(client):
    q = "How late did the station's smoke detector notice the fire?"
    ev = _events(_ask(client, question=q))
    ids = [s["id"] for s in next(e for e in ev if e["type"] == "sources")["sources"]]
    assert "smoke" in ids


def test_general_question_gets_a_sensible_default(client):
    ev = _events(_ask(client, question="Tell me something interesting"))
    ids = [s["id"] for s in next(e for e in ev if e["type"] == "sources")["sources"]]
    assert "limits" in ids and len(ids) >= 2


def test_frame_context_is_the_first_card(client):
    frame = next(iter(assistant.frames()))
    ev = _events(_ask(client, frame=frame, question="How much do the two masks agree?"))
    assert next(e for e in ev if e["type"] == "sources")["sources"][0]["id"] == "frame"
    ev = _events(_ask(client, counts={"a": 100, "b": 80, "shared": 50}))
    assert next(e for e in ev if e["type"] == "sources")["sources"][0]["id"] == "frame"


@pytest.mark.parametrize("body,status", [
    ({"question": ""}, 422), ({"question": "   "}, 422), ({"question": "x" * 1201}, 422),
    ({"frame": "../../etc/passwd"}, 422), ({"frame": "NOPE_000"}, 422),
    ({"history": [{"question": "q", "answer": "a"}] * 7}, 422),
    ({"counts": {"a": -1, "b": 0, "shared": 0}}, 422),
])
def test_bad_input_is_refused(client, body, status):
    res = client.post("/api/assistant/ask", json={"question": "ok?", **body})
    assert res.status_code == status, res.text[:200]


def test_invalid_citations_are_reported(client, monkeypatch):
    from falmex.ai.providers import MockProvider

    monkeypatch.setattr(MockProvider, "stream_text",
                        lambda self, s, p: iter(["Made up [S9] and real [S1]."]))
    done = _events(_ask(client))[-1]
    assert done["cited"] == [1] and done["invalid"] == [9]


def test_model_failure_becomes_a_readable_error_event(client, monkeypatch):
    from falmex.ai.providers import LLMError, MockProvider

    def boom(self, s, p):
        raise LLMError("quota")
        yield ""  # pragma: no cover

    monkeypatch.setattr(MockProvider, "stream_text", boom)
    ev = _events(_ask(client))
    assert ev[-1]["type"] == "error" and "again" in ev[-1]["message"]


def test_rate_limit_per_client(client):
    codes = [_ask(client).status_code for _ in range(14)]
    assert codes[:12] == [200] * 12 and 429 in codes[12:]


def test_a_new_topic_beats_the_previous_question(client):
    ev = _events(_ask(client, question="How late did the station's smoke detector notice the fire?",
                      history=[{"question": "Does more oxygen make droplets burn faster in FLEX?",
                                "answer": "Yes [S1]."}]))
    ids = [s["id"] for s in next(e for e in ev if e["type"] == "sources")["sources"]
           if not s["id"].startswith("tool-")]
    assert ids[0] == "smoke", ids


@pytest.mark.parametrize("name", list(__import__("falmex.assistant_tools").assistant_tools.TOOLS))
def test_every_tool_runs_on_the_real_data(name):
    from falmex import assistant_tools as t

    args = {"flex_scatter": {"x": "oxygen", "y": "burn_time", "fuel": "Heptane"},
            "flame_replay": {"tests": [1, 2]}, "find_tests": {"fuel": "Methanol",
                                                              "oxygen_min": 0.3}}.get(name, {})
    result, card = t.run(name, args)
    assert result["kind"] in ("scatter", "bars", "line", "table", "replay")
    assert result["title"] and card["title"].startswith("Tool:") and card["page"].startswith("/")
    json.dumps(result)  # must be JSON for the stream


def test_a_bad_tool_argument_never_breaks_the_answer(client, monkeypatch):
    monkeypatch.setattr(assistant, "plan", lambda p, q: [
        {"name": "flex_scatter", "args": {"x": "nonsense", "y": "nonsense"}}])
    ev = _events(_ask(client))
    assert not any(e["type"] == "tool" for e in ev) and ev[-1]["type"] == "done"


def test_replay_tool_returns_real_tests(client):
    ev = _events(_ask(client, question="Show me a 3D replay of a heptane burn"))
    tool = next(e for e in ev if e["type"] == "tool")
    assert tool["result"]["kind"] == "replay"
    assert all(k in tool["result"]["tests"][0] for k in ("d0", "k", "tb", "end"))


@pytest.mark.parametrize("name,args", [
    ("correlate", {"x": "oxygen", "y": "burning_rate", "control": "pressure", "fuel": "Heptane"}),
    ("compare_groups", {"variable": "burn_time", "by": "end"}),
    ("describe", {"variable": "initial_diameter", "oxygen_min": 0.2, "oxygen_max": 0.3}),
    ("fit_model", {"outcome": "extinction_ratio", "predictors": ["oxygen", "pressure"]}),
])
def test_data_science_tools_compute_real_statistics(name, args):
    from falmex import assistant_tools as t

    result, card = t.run(name, args)
    assert result.get("stats"), "every analysis states its statistics"
    assert card["facts"]
    json.dumps(result)


@pytest.mark.parametrize("args", [{"x": "nope", "y": "oxygen"}, {"x": "oxygen", "y": "oxygen"},
                                  {"x": "oxygen", "y": "burn_time", "fuel": "Heptane",
                                   "oxygen_min": 0.9}])
def test_correlate_refuses_bad_requests(args):
    from falmex import assistant_tools as t

    with pytest.raises(ValueError):
        t.run("correlate", args)


def test_a_relationship_question_is_tested_with_statistics(client):
    ev = _events(_ask(client, question="Does the burning rate depend on oxygen?"))
    names = [e["name"] for e in ev if e["type"] == "tool"]
    assert "correlate" in names
