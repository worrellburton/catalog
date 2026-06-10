-- Expand the admin DELETE policy on user_generations so admins can
-- delete generations belonging to ANY user, not just AI personas.
--
-- Why: the admin Delete button on /admin/data Looks tab is meant to
-- propagate to the source generation (so the look disappears from
-- the creator's My Looks too) — that's the source-of-truth contract
-- the user keeps asking for. The existing policy restricted admin
-- deletes to is_ai=true persona rows, which left a hole: deleting a
-- real-user look from admin left the source gen behind, so the look
-- reappeared in the creator's My Looks as an "unpublished" entry
-- with no way to know it had been curated away from the catalog.
--
-- Real users can still delete their own gens via user_generations_self_delete.
-- Admin deletes leave an audit trail in the looks history (the
-- looks row's created_by survived the user_id rewrite during the
-- publish flow, so the original promoter is still recoverable).

drop policy if exists user_generations_admin_delete on public.user_generations;

create policy user_generations_admin_delete
  on public.user_generations
  for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and (profiles.is_admin = true or profiles.role in ('admin', 'super_admin'))
    )
  );
