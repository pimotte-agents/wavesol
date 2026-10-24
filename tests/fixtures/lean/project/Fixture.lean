namespace Fx

/-- Doubles a number.
The second line of the docstring. -/
def double (n : Nat) : Nat := n + n

theorem double_eq (n : Nat) : double n = 2 * n := by
  unfold double
  -- ANCHOR: inner
  omega
  -- ANCHOR_END: inner

-- ANCHOR: haveBlock
theorem with_have (a b : Nat) (h : a = b) : b = a := by
  have h' : b = a := by
    rw [h]
  exact h'
-- ANCHOR_END: haveBlock

end Fx

theorem bullets (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
    -- ^ PROOF_STATE: left
  · exact hq
