-- Street edit history in core.core_street_versions + BEFORE UPDATE versioning trigger.
--
-- Depends on routing columns added in 015_routing_street_hierarchy.sql (references OLD.* columns).
--
-- DELETE trigger note:
--   Inserting a child row keyed by streets.id BEFORE DELETE captures the snapshot but then deleting
--   the parent would either (a) violate FK RESTRICT/NONE, or (b) CASCADE-delete the snapshot row.
--   So we audit only BEFORE UPDATE — including transitions to deleted_at/is_active/routing_status.
--   Dashboard/API MUST soft-delete via UPDATE only (see COMMENT on core.core_streets below).

begin;

create table if not exists core.core_street_versions (
    id bigserial primary key,
    street_id bigint not null references core.core_streets (id),
    version_no int not null,
    snapshot_data jsonb not null,
    geom geometry (LineString, 4326),
    edited_by bigint,
    edit_reason text,
    action_type text not null,
    created_at timestamptz not null default now(),
    constraint core_street_versions_street_version_key unique (street_id, version_no)
);

comment on table core.core_street_versions is
    'Historical snapshots of streets before UPDATE; version_no increments per street.';

comment on column core.core_street_versions.snapshot_data is
    'Frozen row payload (scalars + geom as geojson key) before the activating UPDATE.';
comment on column core.core_street_versions.geom is 'Centerline duplicate of OLD.geom when present.';
comment on column core.core_street_versions.edited_by is
    'Optional account id — set via SET LOCAL local_map.editor_id = ''<bigint>'' in the same txn as UPDATE.';
comment on column core.core_street_versions.edit_reason is
    'Optional reason — SET LOCAL local_map.edit_reason = ''...''.';
comment on column core.core_street_versions.action_type is
    '`update`, `soft_delete`, or legacy `restore` when deleted_at clears.';

create index if not exists core_street_versions_street_id_idx
    on core.core_street_versions (street_id);

create index if not exists core_street_versions_street_created_idx
    on core.core_street_versions (street_id, created_at desc);

create index if not exists core_street_versions_geom_gix
    on core.core_street_versions using gist (geom);

-- ---------------------------------------------------------------------------
-- Trigger: BEFORE UPDATE — persist OLD row
-- ---------------------------------------------------------------------------
create or replace function core.trg_fn_core_streets_save_version_before_update ()
    returns trigger
    language plpgsql
    security invoker
    set search_path = core, public, pg_temp
as $function$
declare
    next_no int;
    editor bigint;
    reason text;
    act text := 'update';
begin
    if OLD.deleted_at is distinct from NEW.deleted_at then
        if OLD.deleted_at is null and NEW.deleted_at is not null then
            act := 'soft_delete';
        elsif OLD.deleted_at is not null and NEW.deleted_at is null then
            act := 'restore';
        end if;
    end if;

    select coalesce(max(v.version_no), 0) + 1 into next_no
    from core.core_street_versions v
    where v.street_id = OLD.id;

    begin
        editor := nullif(btrim(current_setting('local_map.editor_id', true)), '')::bigint;
    exception
        when others then
            editor := null;
    end;

    begin
        reason := nullif(btrim(current_setting('local_map.edit_reason', true)), '');
    exception
        when others then
            reason := null;
    end;

    insert into core.core_street_versions (
        street_id,
        version_no,
        snapshot_data,
        geom,
        edited_by,
        edit_reason,
        action_type,
        created_at
    )
    values (
        OLD.id,
        next_no,
        jsonb_strip_nulls(
            jsonb_build_object(
                'id',
                OLD.id,
                'public_id',
                OLD.public_id,
                'canonical_name',
                OLD.canonical_name,
                'admin_area_id',
                OLD.admin_area_id,
                'source_type_id',
                OLD.source_type_id,
                'is_active',
                OLD.is_active,
                'created_at',
                OLD.created_at,
                'updated_at',
                OLD.updated_at,
                'road_class_id',
                OLD.road_class_id,
                'road_class',
                OLD.road_class,
                'surface',
                OLD.surface,
                'is_oneway',
                OLD.is_oneway,
                'bridge',
                OLD.bridge,
                'tunnel',
                OLD.tunnel,
                'layer',
                OLD.layer,
                'source_tags',
                OLD.source_tags,
                'is_verified',
                OLD.is_verified,
                'manual_override',
                OLD.manual_override,
                'edit_status',
                OLD.edit_status,
                'routing_status',
                OLD.routing_status,
                'deleted_at',
                OLD.deleted_at,
                'last_edited_at',
                OLD.last_edited_at,
                'geom_geojson',
                case
                    when OLD.geom is null then null::jsonb
                    else ST_AsGeoJSON(OLD.geom)::jsonb
                end
            )
        ),
        case
            when OLD.geom is null then null::geometry (LineString, 4326)
            when ST_GeometryType(OLD.geom) = 'ST_LineString' then OLD.geom::geometry (LineString, 4326)
            else null::geometry (LineString, 4326)
        end,
        editor,
        reason,
        act,
        now()
    );

    return NEW;
end;
$function$;

drop trigger if exists core_streets_version_before_update on core.core_streets;

create trigger core_streets_version_before_update
    before update on core.core_streets
    for each row
    execute function core.trg_fn_core_streets_save_version_before_update ();

comment on column core.core_streets.deleted_at is
    'Soft-delete: set via UPDATE with is_active = false and routing_status = ''needs_rebuild'' — do not DELETE rows from application code.';

comment on column core.core_streets.routing_status is
    'Routing pipeline state; set needs_rebuild when soft-deleting or changing centerline/routing fields.';

commit;
