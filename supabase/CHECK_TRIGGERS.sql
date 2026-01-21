-- CHECK_TRIGGERS.sql
-- Lista todos los triggers asociados a la tabla 'rides'
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement,
    action_orientation,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'rides';
