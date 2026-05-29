# GTFS export output (skeleton)

This directory was created by tools/transit/gtfs-export/export-gtfs.ts.

**No production GTFS files have been written yet.** Implement export logic per docs/transport/gtfs-export-plan.md.

## Planned files (not generated)

- agency.txt
- stops.txt
- routes.txt
- trips.txt
- stop_times.txt
- calendar.txt
- frequencies.txt
- shapes.txt
- feed_info.txt

## Build metadata (placeholder)

- scope: yangon_local_bus
- build_code: yangon_local_bus_gtfs_2026-05-29
- status: skeleton only

## Next steps

1. Query core_transport for scope filter
2. Implement gtfs-writers per file
3. Zip bundle → gtfs.zip
4. Run validate-gtfs.ts
