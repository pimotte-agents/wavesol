import Lake
open Lake DSL

require subverso from git "https://github.com/leanprover/subverso.git" @ "main"

package demo

@[default_target]
lean_lib Demo
