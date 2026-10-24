/-- A list is a *palindrome* if it reads the same backwards. -/
def Palindrome (xs : List α) : Prop := xs.reverse = xs

-- ANCHOR: revRev
theorem reverse_reverse (xs : List α) : xs.reverse.reverse = xs := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    -- ^ PROOF_STATE: cons
    rw [List.reverse_cons, List.reverse_append, ih]
    rfl
-- ANCHOR_END: revRev

theorem palindrome_reverse (xs : List α) (h : Palindrome xs) : Palindrome xs.reverse := by
  unfold Palindrome at *
  rw [h, h]

theorem add_zero' (n : Nat) : n + 0 = n := by
  induction n with
  | zero => rfl
  | succ k ih => rfl
