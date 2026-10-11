-- Requeued jobs: allow UI to show "Requeued" when a job was put back to queued from stale processing.
alter table public.jobs
  add column if not exists requeued_at timestamptz;

comment on column public.jobs.requeued_at is 'Set when the job was requeued from processing (e.g. after worker restart). Null otherwise.';
