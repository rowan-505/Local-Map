-- Validate the existing transport.fares stop foreign keys in place.
-- Preflight (2026-08-19): 142 fares, zero origin or destination stop orphans.
-- This changes constraint catalog state only; it does not modify fare rows.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE transport.fares
  VALIDATE CONSTRAINT fares_origin_stop_id_fkey;

ALTER TABLE transport.fares
  VALIDATE CONSTRAINT fares_destination_stop_id_fkey;
