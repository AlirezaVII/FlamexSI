"use client";

import { useEffect, useMemo, useState } from "react";
import { FlammabilityChart } from "@/components/flammability-chart";
import { ChartSkeleton, ListSkeleton } from "@/components/loading";
import {
  Button,
  Card,
  ErrorNote,
  NoDataset,
  PageHeader,
  Stat,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import type { FlammabilityMap, ReferenceLimit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

/**
 * Exploration environments. Gravity values are physical constants; cabin atmospheres are
 * design values with their source. They describe the scenario, not flammability: whether a
 * material burns there is estimated only from the loaded experiments.
 */
const ENVIRONMENTS = [
  {
    id: "iss",
    name: "ISS cabin",
    gravity: 0,
    pressure: 101.3,
    oxygen: 21,
    source:
      "ISS keeps a sea-level-equivalent atmosphere (~101 kPa, ~21% O₂); orbit ≈ 0 g (microgravity).",
  },
  {
    id: "moon",
    name: "Lunar habitat",
    gravity: 0.165,
    pressure: 56.5,
    oxygen: 34,
    source:
      "Atmosphere: 56.5 kPa (8.2 psia), 34% O₂, recommended by NASA's Exploration Atmospheres Working Group (NASA/TP-2010-216134). Moon gravity 0.165 g.",
  },
  {
    id: "mars",
    name: "Mars habitat",
    gravity: 0.378,
    pressure: 56.5,
    oxygen: 34,
    source:
      "Same exploration atmosphere (NASA/TP-2010-216134) as a scenario; Mars gravity 0.378 g.",
  },
  {
    id: "earth",
    name: "Earth lab",
    gravity: 1,
    pressure: 101.3,
    oxygen: 21,
    source: "Standard sea-level air: 101.3 kPa, 20.9% O₂; 1 g.",
  },
] as const;

type EnvId = (typeof ENVIRONMENTS)[number]["id"] | "custom";

const input =
  "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

export default function SimulatorPage() {
  const { dataset, loading } = useWorkspace();
  const [axis, setAxis] = useState<"gravity" | "flow_rate">("gravity");
  const [material, setMaterial] = useState<string>("");
  const [envId, setEnvId] = useState<EnvId>("moon");
  const [custom, setCustom] = useState({ x: 0.1, pressure: 70, oxygen: 26 });
  const [result, setResult] = useState<{
    key: string;
    map: FlammabilityMap | null;
    error: string | null;
  } | null>(null);
  const [limits, setLimits] = useState<ReferenceLimit[] | null>(null);

  const env = useMemo(() => {
    if (envId === "custom")
      return {
        name: "Custom",
        x: custom.x,
        pressure: custom.pressure,
        oxygen: custom.oxygen,
        source: "Entered by hand.",
      };
    const e = ENVIRONMENTS.find((v) => v.id === envId)!;
    return {
      name: e.name,
      x: e.gravity,
      pressure: e.pressure,
      oxygen: e.oxygen,
      source: e.source,
    };
  }, [envId, custom]);
  // an environment fixes gravity, not flow: on the flow axis it is a custom point
  const envOnAxis = axis === "gravity" || envId === "custom";

  const datasetId = dataset?.dataset_id;
  const body = useMemo(
    () => ({
      axis,
      material: material || null,
      pressure: env.pressure,
      at_x: envOnAxis ? env.x : null,
      at_oxygen: env.oxygen,
    }),
    [axis, material, env, envOnAxis],
  );
  // a result only counts for the request it answers, so a change shows the loader at once
  const key = `${datasetId}|${JSON.stringify(body)}`;
  useEffect(() => {
    if (!datasetId) return;
    let live = true;
    api
      .flammability(datasetId, body)
      .then((map) => live && setResult({ key, map, error: null }))
      .catch((e) => live && setResult({ key, map: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [datasetId, body, key]);
  const current = result?.key === key ? result : null;
  const map = current?.map ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    api
      .referenceLimits()
      .then(setLimits)
      .catch(() => setLimits([]));
  }, []);

  const shownLimits = (limits ?? []).filter(
    (l) =>
      !map?.material || l.material.toLowerCase() === map.material.toLowerCase(),
  );

  if (!dataset) return loading ? <ListSkeleton rows={4} /> : <NoDataset />;
  const pt = map?.point;

  return (
    <>
      <PageHeader
        eyebrow="Exploration environments"
        title="Flammability simulator"
      >
        Where does a material keep burning, by oxygen and gravity (or flow)? The
        map is estimated only from the experiments in the current dataset; it
        has no built-in numbers. Published limits appear only when the team
        enters them with a citation, and are never mixed into the estimate.
      </PageHeader>
      {dataset.synthetic && <SyntheticBanner />}

      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Horizontal axis
            </span>
            <select
              value={axis}
              onChange={(e) => setAxis(e.target.value as typeof axis)}
              className={input}
            >
              <option value="gravity">Gravity (g)</option>
              <option value="flow_rate">Flow velocity (cm/s)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Material</span>
            <select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className={input}
            >
              <option value="">All materials together</option>
              {(map?.materials ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block text-xs text-muted">Environment</span>
            <div className="flex flex-wrap gap-1.5">
              {[...ENVIRONMENTS, { id: "custom" as const, name: "Custom" }].map(
                (e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEnvId(e.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${envId === e.id ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
                  >
                    {e.name}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
        {envId === "custom" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["x", axis === "gravity" ? "Gravity (g)" : "Flow (cm/s)"],
                ["pressure", "Pressure (kPa)"],
                ["oxygen", "Oxygen (%)"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block text-xs text-muted">{l}</span>
                <input
                  type="number"
                  step="any"
                  value={custom[k]}
                  onChange={(e) =>
                    setCustom({ ...custom, [k]: Number(e.target.value) })
                  }
                  className={input}
                />
              </label>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          {env.name}:{" "}
          {envOnAxis
            ? `${fmt(env.x)} ${axis === "gravity" ? "g" : "cm/s"} · `
            : ""}
          {fmt(env.pressure)} kPa · {fmt(env.oxygen)}% O₂. {env.source}
          {!envOnAxis &&
            " On the flow axis a preset has no flow value; pick Custom to place a point."}
        </p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Flammability map" className="lg:col-span-2">
          {error ? (
            <ErrorNote message={error} />
          ) : !map ? (
            <ChartSkeleton label="Fitting the model to the experiments…" />
          ) : (
            <div className="fade-in">
              <FlammabilityChart
                map={map}
                env={
                  envOnAxis
                    ? { name: env.name, x: env.x, oxygen: env.oxygen }
                    : null
                }
                limits={shownLimits}
              />
            </div>
          )}
        </Card>

        <Card title={`At ${env.name}`}>
          {!map ? (
            error ? (
              <p className="text-sm text-muted">No estimate.</p>
            ) : (
              <ListSkeleton rows={3} />
            )
          ) : (
            <div className="space-y-4">
              {pt ? (
                <>
                  <Stat
                    label="Estimated 50% limit (oxygen)"
                    value={
                      pt.oxygen_limit_50 != null
                        ? `${fmt(pt.oxygen_limit_50, 3)}%`
                        : "—"
                    }
                    hint="Oxygen where the fitted probability of burning is 50%"
                  />
                  {pt.oxygen_limit_ci && (
                    <p className="-mt-3 text-xs text-muted">
                      95% interval {fmt(pt.oxygen_limit_ci[0], 3)}–
                      {fmt(pt.oxygen_limit_ci[1], 3)}%
                    </p>
                  )}
                  <Stat
                    label={`P(burn) at ${fmt(env.oxygen)}% O₂`}
                    value={pt.p_burn != null ? fmt(pt.p_burn, 2) : "—"}
                  />
                  {pt.p_burn_ci && (
                    <p className="-mt-3 text-xs text-muted">
                      95% interval {fmt(pt.p_burn_ci[0], 2)}–
                      {fmt(pt.p_burn_ci[1], 2)}
                    </p>
                  )}
                  {pt.extrapolation.length > 0 && (
                    <p className="rounded-md border border-line bg-surface-2 p-2 text-xs text-ink">
                      <strong>Extrapolation:</strong>{" "}
                      {pt.extrapolation.map(label).join(", ")} is outside the
                      range of the experiments. The model is being asked about
                      conditions it has never seen.
                    </p>
                  )}
                  {pt.oxygen_limit_50 == null && (
                    <p className="text-xs text-ink-2">
                      In this data, burning does not become more likely with
                      oxygen, so no oxygen limit can be estimated.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-2">
                  Pick an environment or a custom point.
                </p>
              )}
              <dl className="space-y-1 border-t border-line pt-3 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted">Experiments</dt>
                  <dd>
                    {map.n} ({map.n_burned} burned)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Material</dt>
                  <dd>{map.material ?? "all"}</dd>
                </div>
                {map.pressure_used != null && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Pressure held at</dt>
                    <dd>{fmt(map.pressure_used, 4)} kPa</dd>
                  </div>
                )}
                {Object.entries(map.coefficients).map(([k, c]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-muted">{label(k)} effect (per SD)</dt>
                    <dd className="tabular-nums">
                      {fmt(c.per_sd, 3)} ± {fmt(c.se, 2)}
                    </dd>
                  </div>
                ))}
              </dl>
              <details className="text-xs text-ink-2">
                <summary className="cursor-pointer text-muted">Method</summary>
                <p className="mt-1 whitespace-pre-line">{map.method}</p>
              </details>
            </div>
          )}
        </Card>
      </div>

      <ReferenceLimits limits={limits} onChange={setLimits} />
    </>
  );
}

const EMPTY = {
  material: "",
  kind: "MOC",
  oxygen_percent: "",
  pressure_kpa: "",
  gravity_g: "",
  flow_cm_s: "",
  source: "",
  url: "",
  note: "",
  entered_by: "",
};

function ReferenceLimits({
  limits,
  onChange,
}: {
  limits: ReferenceLimit[] | null;
  onChange: (l: ReferenceLimit[]) => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save() {
    setError(null);
    try {
      const made = await api.addReferenceLimit({
        ...form,
        oxygen_percent: Number(form.oxygen_percent),
        pressure_kpa: num(form.pressure_kpa),
        gravity_g: num(form.gravity_g),
        flow_cm_s: num(form.flow_cm_s),
      });
      onChange([...(limits ?? []), made]);
      setForm(EMPTY);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    await api.deleteReferenceLimit(id);
    onChange((limits ?? []).filter((l) => l.limit_id !== id));
  }

  return (
    <Card
      title="Published limits (cited)"
      className="mt-4"
      action={
        !open && (
          <Button variant="ghost" onClick={() => setOpen(true)}>
            Add a limit…
          </Button>
        )
      }
    >
      <p className="text-sm text-ink-2">
        Values from NASA reports or papers, each with its full citation. They
        are drawn on the map for comparison and never change the estimate.
      </p>
      {limits === null ? (
        <ListSkeleton rows={2} />
      ) : limits.length === 0 ? (
        <p className="mt-3 text-sm text-muted">None entered yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                {["Material", "Limit", "Conditions", "Source", "By", ""].map(
                  (h) => (
                    <th key={h} className="py-1 pr-3 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {limits.map((l) => (
                <tr key={l.limit_id}>
                  <td className="py-1.5 pr-3">{l.material}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {l.kind} {fmt(l.oxygen_percent)}%
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-ink-2">
                    {[
                      l.pressure_kpa != null && `${fmt(l.pressure_kpa)} kPa`,
                      l.gravity_g != null && `${fmt(l.gravity_g)} g`,
                      l.flow_cm_s != null && `${fmt(l.flow_cm_s)} cm/s`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-ink-2">
                    {l.url ? (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent"
                      >
                        {l.source}
                      </a>
                    ) : (
                      l.source
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-muted">
                    {l.entered_by}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => remove(l.limit_id)}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["material", "Material *"],
              ["kind", "Kind (as the source names it, e.g. MOC) *"],
              ["oxygen_percent", "Oxygen limit (%) *"],
              ["pressure_kpa", "Pressure (kPa)"],
              ["gravity_g", "Gravity (g)"],
              ["flow_cm_s", "Flow (cm/s)"],
              ["entered_by", "Entered by *"],
              ["url", "Link"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="text-sm">
              <span className="mb-1 block text-xs text-muted">{l}</span>
              <input
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className={input}
              />
            </label>
          ))}
          <label className="text-sm sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs text-muted">
              Full citation *
            </span>
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="Authors, title, report number, year, page/table"
              className={input}
            />
          </label>
          {error && (
            <div className="sm:col-span-2 lg:col-span-4">
              <ErrorNote message={error} />
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button onClick={save}>Save limit</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
