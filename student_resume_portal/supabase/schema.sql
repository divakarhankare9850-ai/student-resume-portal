-- Run in Supabase Dashboard > SQL Editor.
-- Replace the sample PRNs below with the actual college-approved PRN list.
create table if not exists public.approved_prns (
  prn text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint approved_prns_uppercase check (prn = upper(trim(prn)))
);

create table if not exists public.resumes (
  prn text primary key references public.approved_prns(prn),
  storage_path text not null unique,
  original_name text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.approved_prns enable row level security;
alter table public.resumes enable row level security;
alter table public.admin_users enable row level security;

-- No browser-side reads/writes to approved PRNs or resume metadata.
-- Admin access to resumes is provided by admin membership policy.
create policy "Admins can read resume metadata"
on public.resumes for select to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create policy "Users can check own admin membership"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

revoke all on public.approved_prns from anon, authenticated;
revoke all on public.resumes from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;
grant select on public.resumes to authenticated;
grant select on public.admin_users to authenticated;

-- Keep the PRN list server-side. The Edge Function uses the service-role key
-- (server-only) to validate it and write the final resume row.
insert into public.approved_prns (prn) values
  ('REPLACE_WITH_REAL_PRN_001'),
  ('REPLACE_WITH_REAL_PRN_002'),
  ('REPLACE_WITH_REAL_PRN_003')
on conflict (prn) do nothing;

-- Storage bucket is created in the Dashboard or with the Supabase CLI.
-- Keep it PRIVATE. Do not add public read policies.
