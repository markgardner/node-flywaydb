CREATE SEQUENCE next_id_seq;

CREATE OR REPLACE FUNCTION _next_id(OUT result bigint) AS $$
DECLARE
    our_epoch bigint := 1450939010372;
    seq_id bigint;
    now_millis bigint;
    shard_id int := 5;
BEGIN
    SELECT nextval('next_id_seq') % 1024 INTO seq_id;

    SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000) INTO now_millis;
    result := (now_millis - our_epoch) << 23;
    result := result | (shard_id << 10);
    result := result | (seq_id);
END;
$$ LANGUAGE PLPGSQL;

CREATE TYPE login_type AS ENUM (
  'local',
  'token');