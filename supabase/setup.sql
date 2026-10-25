-- 우리집 건강검진: Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여 넣고 Run 하세요. (한 번만)
-- 서버에는 기기에서 암호화된 내용만 저장되고, 로그인한 본인만 자기 행을 읽고 쓸 수 있습니다.

-- 데이터 비밀번호 확인용 정보 (비밀번호 자체는 저장하지 않음)
create table if not exists public.vault (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  salt text not null,
  verifier text not null,
  created_at timestamptz not null default now()
);

-- 모든 기록(구성원·검진·수치·항목·설정·원본 정보)을 암호문으로 저장
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,
  id text not null,
  data text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
create index if not exists records_user_updated on public.records (user_id, updated_at);

-- 수정 시각은 서버 시계로 기록 (기기 시계가 틀려도 동기화 순서가 꼬이지 않게)
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
for each row execute function public.records_touch();

alter table public.vault enable row level security;
alter table public.records enable row level security;

drop policy if exists "own vault" on public.vault;
create policy "own vault" on public.vault for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own records" on public.records;
create policy "own records" on public.records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.vault, public.records to authenticated;

-- 원본 페이지 이미지(암호화된 파일) 저장소: 사용자별 폴더만 접근 가능
insert into storage.buckets (id, name, public)
values ('pages', 'pages', false)
on conflict (id) do nothing;

drop policy if exists "own pages select" on storage.objects;
create policy "own pages select" on storage.objects for select to authenticated
  using (bucket_id = 'pages' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own pages insert" on storage.objects;
create policy "own pages insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'pages' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own pages update" on storage.objects;
create policy "own pages update" on storage.objects for update to authenticated
  using (bucket_id = 'pages' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own pages delete" on storage.objects;
create policy "own pages delete" on storage.objects for delete to authenticated
  using (bucket_id = 'pages' and (storage.foldername(name))[1] = auth.uid()::text);
