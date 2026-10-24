/-- A list is *palindromic* if it equals its reverse. -/
def Palindrome (xs : List α) : Prop := xs.reverse = xs

-- ANCHOR: revRev
theorem rev_rev (xs : List α) : xs.reverse.reverse = xs := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    -- ^ PROOF_STATE: cons_case
    simp
-- ANCHOR_END: revRev

-- ANCHOR: addComm
theorem add_comm' (a b : Nat) : a + b = b + a := by
  induction b with
  | zero => simp
  | succ n ih =>
    rw [Nat.add_succ, ih]
    omega
-- ANCHOR_END: addComm

theorem palindrome_nil : Palindrome ([] : List α) := by
  unfold Palindrome
  rfl
