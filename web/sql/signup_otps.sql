-- 가입 전 이메일 인증용 OTP (인증 후에만 계정 생성)
-- Supabase SQL Editor에서 실행
create table if not exists public.signup_otps (
  email text not null primary key,
  otp_hash text not null,
  nickname text not null,
  expires_at timestamptz not null
);

-- 만료된 행 정리용 인덱스 (선택)
create index if not exists signup_otps_expires_at_idx on public.signup_otps (expires_at);

-- RLS: 서버(service role)만 접근. anon/authenticated 접근 불가.
alter table public.signup_otps enable row level security;

-- 정책 없음 = 아무 역할도 select/insert/update/delete 불가. service_role 만 접근 가능.
-- (API는 supabaseAdmin = service_role 사용)
