create table if not exists public.hourlog_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hourlog_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default 'User',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hourlog_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_target_hours numeric not null default 6.5,
  tracking_start_month text not null default to_char(now(), 'YYYY-MM'),
  timezone text not null default 'Local',
  target_version integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hourlog_holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  holiday_date date not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, holiday_date)
);

create table if not exists public.hourlog_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.hourlog_settings
  add column if not exists timezone text not null default 'Local';

alter table public.hourlog_sessions enable row level security;
alter table public.hourlog_profiles enable row level security;
alter table public.hourlog_settings enable row level security;
alter table public.hourlog_holidays enable row level security;
alter table public.hourlog_admins enable row level security;

drop policy if exists "Users can read own sessions" on public.hourlog_sessions;
drop policy if exists "Users can insert own sessions" on public.hourlog_sessions;
drop policy if exists "Users can update own sessions" on public.hourlog_sessions;
drop policy if exists "Users can delete own sessions" on public.hourlog_sessions;
drop policy if exists "Admins can read all sessions" on public.hourlog_sessions;
drop policy if exists "Users can read own profile" on public.hourlog_profiles;
drop policy if exists "Users can insert own profile" on public.hourlog_profiles;
drop policy if exists "Users can update own profile" on public.hourlog_profiles;
drop policy if exists "Admins can read all profiles" on public.hourlog_profiles;
drop policy if exists "Users can read own settings" on public.hourlog_settings;
drop policy if exists "Users can insert own settings" on public.hourlog_settings;
drop policy if exists "Users can update own settings" on public.hourlog_settings;
drop policy if exists "Admins can read all settings" on public.hourlog_settings;
drop policy if exists "Users can read own holidays" on public.hourlog_holidays;
drop policy if exists "Users can insert own holidays" on public.hourlog_holidays;
drop policy if exists "Users can update own holidays" on public.hourlog_holidays;
drop policy if exists "Users can delete own holidays" on public.hourlog_holidays;
drop policy if exists "Admins can read all holidays" on public.hourlog_holidays;
drop policy if exists "Admins can read admin list" on public.hourlog_admins;

create policy "Users can read own sessions"
  on public.hourlog_sessions for select
  using (auth.uid() = user_id);

create policy "Admins can read all sessions"
  on public.hourlog_sessions for select
  using (
    exists (
      select 1 from public.hourlog_admins
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "Users can insert own sessions"
  on public.hourlog_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.hourlog_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own sessions"
  on public.hourlog_sessions for delete
  using (auth.uid() = user_id);

create policy "Users can read own profile"
  on public.hourlog_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.hourlog_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.hourlog_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can read all profiles"
  on public.hourlog_profiles for select
  using (
    exists (
      select 1 from public.hourlog_admins
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "Users can read own settings"
  on public.hourlog_settings for select
  using (auth.uid() = user_id);

create policy "Admins can read all settings"
  on public.hourlog_settings for select
  using (
    exists (
      select 1 from public.hourlog_admins
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "Users can insert own settings"
  on public.hourlog_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on public.hourlog_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read own holidays"
  on public.hourlog_holidays for select
  using (auth.uid() = user_id);

create policy "Admins can read all holidays"
  on public.hourlog_holidays for select
  using (
    exists (
      select 1 from public.hourlog_admins
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "Users can insert own holidays"
  on public.hourlog_holidays for insert
  with check (auth.uid() = user_id);

create policy "Users can update own holidays"
  on public.hourlog_holidays for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own holidays"
  on public.hourlog_holidays for delete
  using (auth.uid() = user_id);

create policy "Admins can read admin list"
  on public.hourlog_admins for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- After running this file, add your admin once in Supabase SQL editor:
-- insert into public.hourlog_admins (email) values ('your-admin@email.com') on conflict (email) do nothing;
