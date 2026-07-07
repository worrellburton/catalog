-- Styling self-heal — auto-seed the gaps the catalog can't dress.
--
-- For every styling scenario, for BOTH men and women, build the gender-correct
-- slot plan (mirrors style-engine: men get no dress; always torso+bottom+shoes)
-- and check whether the catalog actually stocks an on-occasion piece for each
-- slot. "On-occasion" = an active product of that gender whose name + type +
-- occasion text matches the occasion QUALIFIER + the garment noun (AND-tsquery,
-- so "formal shoes" needs both 'formal' and 'shoes' — sneakers tagged casual
-- won't satisfy a formal scenario). Misses are queued to the Searches demand
-- tab as kind='manual', approved, so the seeding loop fetches them.
--
-- Pure SQL, NO Claude — gap detection is retrieval, not reasoning, so the loop
-- stays free and keeps working even with zero AI credits. The qualifier comes
-- from the scenario's formality/season; the seed term is a short, reusable
-- garment phrase ("men's formal jacket") = a cheap direct SerpAPI search.
-- See docs/CATALOG_SEEDING.md.

create or replace function public.sweep_style_gaps()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int := 0;
  r record;
  g text;
  v_slots text[];
  v_slot text;
  v_noun text;
  v_qual text;
  v_genw text;
  v_term text;
  v_covered boolean;
begin
  for r in
    select lower(coalesce(intent->>'occasion', term)) as occasion,
           coalesce((intent->>'formality')::int, 2)    as formality,
           lower(coalesce(intent->>'season','any'))    as season,
           coalesce(intent->'slots','[]'::jsonb)        as slots
    from public.seed_targets
    where kind = 'scenario' and intent is not null
  loop
    v_qual := case when r.formality >= 4 then 'formal'
                   when r.formality <= 1 then 'casual'
                   when r.season <> 'any' then r.season
                   else '' end;

    foreach g in array array['male','female']
    loop
      v_genw := case when g = 'male' then 'men''s' else 'women''s' end;

      -- Slot plan for this gender (mirrors the engine's completeness guard).
      select array_agg(x) into v_slots from jsonb_array_elements_text(r.slots) x;
      v_slots := coalesce(v_slots, array[]::text[]);
      if g = 'male' and 'dresses' = any(v_slots) then
        v_slots := array_remove(v_slots, 'dresses') || array['tops','bottoms'];
      end if;
      if not ('dresses' = any(v_slots) or 'tops' = any(v_slots)) then
        v_slots := v_slots || array['tops','bottoms'];
      end if;
      if not ('shoes' = any(v_slots)) then v_slots := v_slots || 'shoes'; end if;
      select array_agg(distinct s) into v_slots from unnest(v_slots) s;

      foreach v_slot in array v_slots
      loop
        v_noun := case v_slot
          when 'hats' then 'hat'   when 'tops' then 'shirt'  when 'jackets' then 'jacket'
          when 'dresses' then 'dress' when 'bottoms' then 'pants' when 'shoes' then 'shoes'
          else v_slot end;

        select exists(
          select 1 from public.products p
          where p.is_active and (p.gender = g or p.gender = 'unisex')
            and to_tsvector('english',
                  coalesce(p.name,'') || ' ' || coalesce(p.type,'') || ' ' ||
                  coalesce(public.product_occasions_text(p.styling_metadata, p.fit_intelligence, p.product_taxonomy), ''))
                @@ plainto_tsquery('english', btrim(v_qual || ' ' || v_noun))
        ) into v_covered;

        if not v_covered then
          v_term := btrim(regexp_replace(v_genw || ' ' || v_qual || ' ' || v_noun, '\s+', ' ', 'g'));
          insert into public.seed_targets (term, kind, status, priority)
          values (v_term, 'manual', 'approved', 55)
          on conflict (lower(term), kind) do nothing;
          if found then affected := affected + 1; end if;
        end if;
      end loop;
    end loop;
  end loop;

  return affected;
end $$;

revoke all on function public.sweep_style_gaps() from public;
grant execute on function public.sweep_style_gaps() to authenticated, service_role;

-- Daily self-heal. Pure SQL (no spend); only queues demand. The seeding
-- kill-switch + budget still gate the actual fetch. Shows in the Automation
-- panel (jobname seeding-*) and is pausable there.
select cron.unschedule('seeding-gap-sweep') where exists (select 1 from cron.job where jobname = 'seeding-gap-sweep');
select cron.schedule('seeding-gap-sweep', '0 4 * * *', 'select public.sweep_style_gaps();');
