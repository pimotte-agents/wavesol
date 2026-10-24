# Lean reader fixtures

SubVerso's highlighted-module JSON, generated with the SubVerso version wavesol pins (see
`project/lakefile.lean` and `docs/lean/lakefile.lean`; keep them on the same version). The reader
(`src/plugins/lean/subverso.ts`) is tested against these files.

After bumping SubVerso or the toolchain, regenerate both and fix the reader until its tests pass:

```sh
(cd tests/fixtures/lean/project && lake build +Fixture:highlighted) && cp tests/fixtures/lean/project/.lake/build/highlighted/Fixture.json tests/fixtures/lean/
(cd docs/lean && lake build Proofs:highlighted) && cp docs/lean/.lake/build/highlighted/Proofs/Lists.json tests/fixtures/lean/
```
