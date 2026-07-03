-- ShareWay secure ride reservation RPC
-- No triggers. Uses row locking to avoid double booking and last-seat race conditions.

create or replace function public.sw_column_name(p_table_name text, p_candidates text[])
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_column text;
begin
  foreach v_column in array p_candidates loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = p_table_name
        and column_name = v_column
    ) then
      return v_column;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.sw_column_udt(p_table_name text, p_column_name text)
returns text
language sql
stable
set search_path = public
as $$
  select udt_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table_name
    and column_name = p_column_name
  limit 1;
$$;

create or replace function public.sw_active_reservations_for_ride(p_ride_id text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_table text;
  v_ride_col text;
  v_status_col text;
  v_seats_col text;
  v_sql text;
  v_count integer := 0;
  v_total integer := 0;
begin
  foreach v_table in array array['ride_passengers', 'bookings'] loop
    if to_regclass('public.' || v_table) is not null then
      v_ride_col := public.sw_column_name(v_table, array['ride_id', 'trip_id']);
      v_status_col := public.sw_column_name(v_table, array['status', 'booking_status']);
      v_seats_col := public.sw_column_name(v_table, array['seats_reserved', 'num_seats', 'seats', 'seat_count']);

      if v_ride_col is not null then
        if v_seats_col is not null then
          v_sql := format(
            'select coalesce(sum(greatest(coalesce(%1$I::int, 1), 1)), 0)::int from public.%2$I where %3$I::text = $1',
            v_seats_col,
            v_table,
            v_ride_col
          );
        else
          v_sql := format(
            'select count(*)::int from public.%1$I where %2$I::text = $1',
            v_table,
            v_ride_col
          );
        end if;

        if v_status_col is not null then
          v_sql := v_sql || format(
            ' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'', ''rejected'', ''declined'', ''denied'', ''no_show'', ''refunded'')',
            v_status_col
          );
        end if;

        execute v_sql into v_count using p_ride_id;
        v_total := v_total + coalesce(v_count, 0);
      end if;
    end if;
  end loop;

  return v_total;
end;
$$;

create or replace function public.sw_reserve_ride_seat(
  p_ride_id text,
  p_passenger_id uuid default auth.uid(),
  p_num_seats integer default 1,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passenger_id uuid := coalesce(p_passenger_id, auth.uid());
  v_num_seats integer := greatest(1, least(coalesce(p_num_seats, 1), 8));
  v_ride record;
  v_has_seats_available boolean := false;
  v_total_seats integer := 1;
  v_available_seats integer := 0;
  v_active_reservations integer := 0;
  v_target_table text := null;
  v_ride_col text;
  v_user_col text;
  v_status_col text;
  v_seats_col text;
  v_note_col text;
  v_created_col text;
  v_ride_col_type text;
  v_user_col_type text;
  v_existing boolean := false;
  v_insert_cols text;
  v_insert_vals text;
  v_sql text;
  v_booking_id text := null;
  v_notify_ok boolean := false;
begin
  if v_passenger_id is null then
    return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Debes iniciar sesión para reservar');
  end if;

  if p_ride_id is null or trim(p_ride_id) = '' then
    return jsonb_build_object('success', false, 'code', 'missing_ride_id', 'message', 'Falta el ID del viaje');
  end if;

  if to_regclass('public.rides') is null then
    return jsonb_build_object('success', false, 'code', 'missing_rides_table', 'message', 'No existe la tabla rides');
  end if;

  -- Lock the ride row to prevent two users taking the last seat at the same time.
  select
    r.id::text as ride_id,
    r.driver_id::uuid as driver_id,
    lower(coalesce(r.status::text, '')) as status_text,
    r.departure_time::timestamptz as departure_time,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'rides' and column_name = 'seats'
    ) then coalesce(r.seats::int, 1) else 1 end as total_seats,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'rides' and column_name = 'seats_available'
    ) then coalesce(r.seats_available::int, null) else null end as seats_available_value
  into v_ride
  from public.rides r
  where r.id::text = p_ride_id
  for update;

  if v_ride.ride_id is null then
    return jsonb_build_object('success', false, 'code', 'ride_not_found', 'message', 'El viaje no existe');
  end if;

  if v_ride.driver_id = v_passenger_id then
    return jsonb_build_object('success', false, 'code', 'own_ride', 'message', 'No puedes reservar tu propio viaje');
  end if;

  if v_ride.status_text in ('completed', 'finished', 'cancelled', 'canceled', 'expired', 'archived') then
    return jsonb_build_object('success', false, 'code', 'ride_unavailable', 'message', 'Este viaje ya no está disponible');
  end if;

  if v_ride.departure_time is not null and v_ride.departure_time <= now() then
    return jsonb_build_object('success', false, 'code', 'ride_past', 'message', 'La hora de salida ya pasó');
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name = 'seats_available'
  ) into v_has_seats_available;

  v_total_seats := greatest(coalesce(v_ride.total_seats, 1), 1);

  if v_has_seats_available and v_ride.seats_available_value is not null then
    v_available_seats := greatest(v_ride.seats_available_value, 0);
  else
    v_active_reservations := public.sw_active_reservations_for_ride(p_ride_id);
    v_available_seats := greatest(v_total_seats - v_active_reservations, 0);
  end if;

  if v_available_seats < v_num_seats then
    return jsonb_build_object(
      'success', false,
      'code', 'not_enough_seats',
      'message', 'No quedan suficientes plazas disponibles',
      'availableSeats', v_available_seats
    );
  end if;

  -- Choose the reservation table available in this project.
  if to_regclass('public.ride_passengers') is not null then
    v_target_table := 'ride_passengers';
  elsif to_regclass('public.bookings') is not null then
    v_target_table := 'bookings';
  else
    return jsonb_build_object('success', false, 'code', 'missing_booking_table', 'message', 'No existe tabla de reservas');
  end if;

  v_ride_col := public.sw_column_name(v_target_table, array['ride_id', 'trip_id']);
  v_user_col := public.sw_column_name(v_target_table, array['passenger_id', 'user_id', 'requester_id', 'profile_id']);
  v_status_col := public.sw_column_name(v_target_table, array['status', 'booking_status']);
  v_seats_col := public.sw_column_name(v_target_table, array['seats_reserved', 'num_seats', 'seats', 'seat_count']);
  v_note_col := public.sw_column_name(v_target_table, array['note', 'notes', 'message', 'details']);
  v_created_col := public.sw_column_name(v_target_table, array['created_at']);

  if v_ride_col is null or v_user_col is null then
    return jsonb_build_object('success', false, 'code', 'invalid_booking_schema', 'message', 'La tabla de reservas no tiene columnas de viaje/usuario compatibles');
  end if;

  v_ride_col_type := public.sw_column_udt(v_target_table, v_ride_col);
  v_user_col_type := public.sw_column_udt(v_target_table, v_user_col);

  v_sql := format(
    'select exists (select 1 from public.%1$I where %2$I::text = $1 and %3$I::text = $2',
    v_target_table,
    v_ride_col,
    v_user_col
  );

  if v_status_col is not null then
    v_sql := v_sql || format(
      ' and lower(coalesce(%I::text, '''')) not in (''cancelled'', ''canceled'', ''rejected'', ''declined'', ''denied'', ''no_show'', ''refunded'')',
      v_status_col
    );
  end if;

  v_sql := v_sql || ')';

  execute v_sql into v_existing using p_ride_id, v_passenger_id::text;

  if v_existing then
    return jsonb_build_object('success', false, 'code', 'already_reserved', 'message', 'Ya tienes una reserva o solicitud activa para este viaje');
  end if;

  v_insert_cols := format('%I, %I', v_ride_col, v_user_col);
  v_insert_vals := case when v_ride_col_type = 'uuid' then '$1::uuid' else '$1::text' end || ', ' ||
                   case when v_user_col_type = 'uuid' then '$2::uuid' else '$2::text' end;

  if v_status_col is not null then
    v_insert_cols := v_insert_cols || format(', %I', v_status_col);
    v_insert_vals := v_insert_vals || ', $3::text';
  end if;

  if v_seats_col is not null then
    v_insert_cols := v_insert_cols || format(', %I', v_seats_col);
    v_insert_vals := v_insert_vals || ', $4::int';
  end if;

  if v_note_col is not null then
    v_insert_cols := v_insert_cols || format(', %I', v_note_col);
    v_insert_vals := v_insert_vals || ', $5::text';
  end if;

  if v_created_col is not null then
    v_insert_cols := v_insert_cols || format(', %I', v_created_col);
    v_insert_vals := v_insert_vals || ', now()';
  end if;

  v_sql := format(
    'insert into public.%I (%s) values (%s) returning id::text',
    v_target_table,
    v_insert_cols,
    v_insert_vals
  );

  execute v_sql into v_booking_id using p_ride_id, v_passenger_id, 'pending', v_num_seats, p_note;

  if v_has_seats_available then
    update public.rides
    set seats_available = greatest(coalesce(seats_available, v_total_seats) - v_num_seats, 0)
    where id::text = p_ride_id;
  end if;

  -- Optional notification to driver, only if the helper exists.
  begin
    perform public.create_system_notification(
      v_ride.driver_id,
      v_passenger_id,
      'booking_request',
      'Nueva solicitud de reserva',
      'Un pasajero ha solicitado una plaza en tu viaje.',
      '/ride/' || p_ride_id,
      'ride',
      p_ride_id,
      'high',
      jsonb_build_object(
        'rideId', p_ride_id,
        'passengerId', v_passenger_id,
        'numSeats', v_num_seats,
        'bookingTable', v_target_table,
        'bookingId', v_booking_id
      )
    );
    v_notify_ok := true;
  exception when others then
    v_notify_ok := false;
  end;

  return jsonb_build_object(
    'success', true,
    'code', 'reserved',
    'message', 'Reserva creada correctamente',
    'rideId', p_ride_id,
    'bookingId', v_booking_id,
    'bookingTable', v_target_table,
    'status', 'pending',
    'seatsReserved', v_num_seats,
    'availableSeatsBefore', v_available_seats,
    'availableSeatsAfter', greatest(v_available_seats - v_num_seats, 0),
    'notificationSent', v_notify_ok
  );
end;
$$;

grant execute on function public.sw_reserve_ride_seat(text, uuid, integer, text) to authenticated;
notify pgrst, 'reload schema';
