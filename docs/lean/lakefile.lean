import Lake
open Lake DSL

-- SubVerso extracts highlighting, hovers and goal states for wavesol's Lean nodes
require subverso from git "https://github.com/leanprover/subverso.git" @ "verso-v4.35.0"

package proofs

@[default_target]
lean_lib Proofs
