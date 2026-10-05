-- Migration: public.send_daily_quote()
-- Pulled from the live database on 2026-10-05 (source of truth: Supabase).
--
-- Triggered by pg_cron job id 1 in production, schedule '30 2 * * 1-6'
-- (= 02:30 UTC = 08:00 IST, Monday-Saturday; Sundays intentionally skipped).
--
-- All secrets (telegram_bot_token, telegram_chat_id, edge_fn_secret,
-- openai/gemini keys) live in table app_secrets and are NEVER committed.
--
-- To schedule (only on a fresh database; already live in production):
--   select cron.schedule('daily-quote-send', '30 2 * * 1-6',
--                        $$select public.send_daily_quote()$$);
-- Verify:  select jobid, schedule, command from cron.job;

CREATE OR REPLACE FUNCTION public.send_daily_quote()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quote text;
  v_id integer;
  v_token text;
  v_chat text;
  v_openai text;
  v_gemini text;
  v_model text;
  v_job bigint;
begin
  -- prefer quotes that already have a premium card in storage
  select id, text into v_id, v_quote from quotes where has_image order by random() limit 1;
  if v_quote is null then
    select id, text into v_id, v_quote from quotes order by random() limit 1;
  end if;
  if v_quote is null then
    v_quote := 'The best way to get started is to quit talking and begin doing.';
    v_id := null;
  end if;

  select value into v_token from app_secrets where key = 'telegram_bot_token';
  select value into v_chat from app_secrets where key = 'telegram_chat_id';
  select value into v_openai from app_secrets where key = 'openai_api_key';
  select value into v_gemini from app_secrets where key = 'gemini_api_key';
  select value into v_model from app_secrets where key = 'gemini_model';

  select net.http_post(
    url := 'https://ifnaqugtthrpmcikivok.supabase.co/functions/v1/daily-quote',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from app_secrets where key = 'edge_fn_secret')
    ),
    body := jsonb_build_object(
      'secret', (select value from app_secrets where key = 'edge_fn_secret'),
      'quote', v_quote,
      'quote_id', case when v_id is null then '' else v_id::text end,
      'chat_id', v_chat,
      'bot_token', v_token,
      'openai_key', coalesce(v_openai, ''),
      'gemini_key', coalesce(v_gemini, ''),
      'gemini_model', coalesce(v_model, 'gemini-2.5-flash-image')
    ),
    timeout_milliseconds := 120000
  ) into v_job;

  return v_job;
end;
$function$

