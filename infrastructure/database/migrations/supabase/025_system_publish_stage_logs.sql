-- Publish batch validation stage logs (dry-run progress timeline).

create table if not exists system.system_publish_stage_logs (
    id bigserial primary key,
    publish_batch_id bigint not null references system.system_publish_batches (id) on delete cascade,
    stage_key text not null,
    stage_label text not null,
    stage_status text not null default 'running',
    message text null,
    progress_percent numeric not null default 0,
    details jsonb not null default '{}'::jsonb,
    started_at timestamptz not null default now(),
    finished_at timestamptz null,
    constraint system_publish_stage_logs_status_chk check (
        stage_status in ('pending', 'running', 'success', 'warning', 'failed', 'skipped')
    )
);

create index if not exists system_publish_stage_logs_batch_started_idx
    on system.system_publish_stage_logs (publish_batch_id, started_at);

create index if not exists system_publish_stage_logs_batch_stage_key_idx
    on system.system_publish_stage_logs (publish_batch_id, stage_key);

comment on table system.system_publish_stage_logs is
    'Per-stage progress for publish batch dry-run validation (import-review promotion).';
