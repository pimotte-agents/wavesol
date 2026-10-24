import Lake
open Lake DSL

-- Generates the reader's fixtures with the pinned SubVerso; see tests/fixtures/lean/README.md
require subverso from git "https://github.com/leanprover/subverso.git" @ "verso-v4.35.0"

package fixture

@[default_target]
lean_lib Fixture where
  -- Fixture/Broken.lean is not imported: it only exists to fail (tests/unit/lean-build.test.ts)
  globs := #[.andSubmodules `Fixture]
