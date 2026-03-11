# Benchmark Artifacts

`scripts/runBenchmark.ts` writes benchmark outputs here.

Suggested layout:

- `benchmarks/baselines/<scenario>/source.png`
- `benchmarks/runs/<timestamp>/<scenario>/source.png`
- `benchmarks/runs/<timestamp>/<scenario>/replay/*`
- `benchmarks/runs/<timestamp>/<scenario>/portable/*`
- `benchmarks/runs/<timestamp>/summary.json`
- `benchmarks/runs/<timestamp>/summary.txt`

`baselines/` is safe to commit when you want stable reference images.
`runs/` is intended for local or CI artifacts and is ignored by git.
