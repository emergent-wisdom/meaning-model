// Adapt explicitly projected scalar readings without guessing dates, joining
// separate series, resolving conflicting records or promoting review approval.
export function typedScalarTrajectories(data) {
  return (data?.typedScalarSeries ?? []).filter((series) => series.interpolation?.kind === 'linear-visual-guide'
    && !series.conflicts?.length && Array.isArray(series.points) && series.points.length >= 2
    && series.points.every((point, index) => Number.isFinite(point.t) && Number.isFinite(point.v)
      && (index === 0 || point.t > series.points[index - 1].t)))
    .map((series) => {
      const row = structuredClone(series);
      return { ...row, kind: 'typed-scalar', owner: null, home: row.home ?? null, sourceEventIds: row.sourceEventIds ?? [],
        domain: [row.points[0].t, row.points.at(-1).t], group: { id: 'typed-scalars', label: 'Dated process values' },
        interpolation: { ...row.interpolation, kind: 'linear-visual-guide', extrapolate: false } };
    });
}
