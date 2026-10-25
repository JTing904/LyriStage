-- 歌词英文翻译的缓存（2026-10-30）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 网易云只有中文翻译，英文翻译由 LyriStage 的服务器（Vercel）请微软翻译做，
-- 翻好的存在这里，同一首歌只翻一次，之后所有人直接拿。
-- 成员只能读；只有服务器写得进去：写入要带一组密码（存在 Vercel 的 LYRIC_CACHE_SECRET），
-- 这里只存它的 SHA-256 指纹，比对指纹，不存密码本身。

create table if not exists public.lyric_translations (
  song_id    bigint      not null,
  lang       text        not null check (lang in ('en')),
  -- LRC 格式（[00:12.34]English line）；空字符串 = 不用翻（本来就是英文、没有歌词）
  lyric      text        not null check (length(lyric) <= 200000),
  created_at timestamptz not null default now(),
  primary key (song_id, lang)
);

alter table public.lyric_translations enable row level security;
revoke all on public.lyric_translations from anon, authenticated;
grant select on public.lyric_translations to authenticated;

drop policy if exists "members read translations" on public.lyric_translations;
create policy "members read translations" on public.lyric_translations
  for select to authenticated
  using ((select public.is_member()));

-- 服务器写入用的密码指纹
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.lyric_cache_secret (
  id   integer primary key default 1 check (id = 1),
  hash text not null
);
revoke all on private.lyric_cache_secret from public, anon, authenticated;

insert into private.lyric_cache_secret (hash)
values ('78fa5b4bcb57fd4e9834d6c94b293590ef3bca50d4caa12a9e829571da4fb881')
on conflict (id) do update set hash = excluded.hash;

create or replace function public.save_lyric_translation(
  secret text, p_song_id bigint, p_lang text, p_lyric text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if secret is null or length(secret) < 32 or not exists (
    select 1 from private.lyric_cache_secret s
    where s.hash = encode(extensions.digest(secret, 'sha256'), 'hex')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.lyric_translations (song_id, lang, lyric)
  values (p_song_id, p_lang, coalesce(p_lyric, ''))
  on conflict (song_id, lang) do update
    set lyric = excluded.lyric, created_at = now();
end;
$$;
revoke execute on function public.save_lyric_translation(text, bigint, text, text) from public;
grant execute on function public.save_lyric_translation(text, bigint, text, text) to anon, authenticated;

-- 应该是 1（指纹存好了）
select count(*) as fingerprint_saved from private.lyric_cache_secret;
