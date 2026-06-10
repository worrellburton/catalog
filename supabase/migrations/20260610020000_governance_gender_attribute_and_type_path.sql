-- Gender lanes become color-coded attributes instead of tree nodes, and
-- products gain a materialized type_path (full chain from root) so a
-- product's whole ancestry lives queryably on the row while products.type
-- stays the leaf name.

alter table product_types add column if not exists gender text
  check (gender in ('male','female','unisex'));

-- Push each lane's name onto its children as the gender attribute, lift
-- the children up to the lane's parent, then drop the lane nodes.
update product_types c set gender = l.name
  from product_types l
  where c.parent_id = l.id and l.name in ('male','female','unisex');
update product_types c set parent_id = l.parent_id
  from product_types l
  where c.parent_id = l.id and l.name in ('male','female','unisex');
delete from product_types where name in ('male','female','unisex');

alter table products add column if not exists type_path text;

-- Same normalization the app uses to match products.type to a node name.
create or replace function normalize_type_name(s text) returns text
language sql immutable as $$
  select case
    when n like '%ses' then left(n, length(n) - 2)
    when n like '%ss' then n
    when n like '%s' and length(n) > 2 then left(n, length(n) - 1)
    else n
  end
  from (select lower(trim(s)) as n) t
$$;

with recursive paths as (
  select id, name, name::text as path from product_types where parent_id is null
  union all
  select t.id, t.name, p.path || ' / ' || t.name
  from product_types t join paths p on t.parent_id = p.id
)
update products pr set type_path = paths.path
from paths
where pr.type is not null
  and normalize_type_name(pr.type) = normalize_type_name(paths.name);
