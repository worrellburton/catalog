-- When a referral is redeemed, also credit the inviter's withdrawable
-- wallet ledger ($0.25 by default). wallet_entries is a running ledger
-- with carried-forward totals (current_balance / total_earning /
-- total_withdraw), so we read the inviter's most recent row and append
-- a new credit. Gated on the on-conflict insert into referrals so the
-- credit only fires on the FIRST redemption per referred user (idempotent).
create or replace function public.redeem_referral(ref_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_ref_id uuid;
  v_handle text;
  v_norm   text := lower(btrim(coalesce(ref_code, '')));
  v_reward int := 25; -- cents
  v_amount numeric := v_reward / 100.0;
  v_prev_balance numeric := 0;
  v_prev_earning numeric := 0;
  v_prev_withdraw numeric := 0;
  v_inserted bool := false;
begin
  if v_uid is null or v_norm = '' then
    return jsonb_build_object('ok', false, 'reason', 'no-auth-or-code');
  end if;
  select id, handle into v_ref_id, v_handle from public.creators where lower(handle) = v_norm limit 1;
  if v_handle is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown-referrer');
  end if;
  if v_ref_id = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into public.referrals (referrer_handle, referrer_id, referred_user_id, referred_email, reward_cents)
  values (v_handle, v_ref_id, v_uid, v_email, v_reward)
  on conflict (referred_user_id) do nothing
  returning true into v_inserted;

  update public.waitlist set approved = true, approved_at = now()
   where v_email is not null and lower(email) = lower(v_email);
  if not found and v_email is not null then
    insert into public.waitlist (id, email, approved, approved_at)
    values (gen_random_uuid(), v_email, true, now());
  end if;

  if coalesce(v_inserted, false) and v_ref_id is not null then
    select current_balance, total_earning, total_withdraw
      into v_prev_balance, v_prev_earning, v_prev_withdraw
      from public.wallet_entries
     where user_id = v_ref_id
     order by created_at desc limit 1;
    v_prev_balance  := coalesce(v_prev_balance, 0);
    v_prev_earning  := coalesce(v_prev_earning, 0);
    v_prev_withdraw := coalesce(v_prev_withdraw, 0);

    insert into public.wallet_entries
      (id, user_id, amount, type, current_balance, total_earning, total_withdraw, comment, entry_code, created_at)
    values
      (gen_random_uuid(), v_ref_id, v_amount, 'credit',
       v_prev_balance + v_amount, v_prev_earning + v_amount, v_prev_withdraw,
       'Referral reward — invited ' || coalesce(v_email, 'a shopper'),
       'referral', now());
  end if;

  return jsonb_build_object('ok', true, 'referrer', v_handle, 'credited', coalesce(v_inserted, false));
end;
$$;
grant execute on function public.redeem_referral(text) to authenticated;
