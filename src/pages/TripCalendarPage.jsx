import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, Car, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { cn } from '@/lib/utils.js';
import { getLocalDateKey, getTripCalendarEvents, getUpcomingEvents, groupEventsByDate } from '@/services/calendarService.js';

const STATUS_STYLES = {
  scheduled: 'bg-blue-50 text-blue-600 border-blue-100',
  active: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  in_progress: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  completed: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-red-50 text-red-600 border-red-100',
  fulfilled: 'bg-indigo-50 text-indigo-600 border-indigo-100',
};

const statusLabel = (status) => ({
  scheduled: 'Programado',
  active: 'Activo',
  in_progress: 'En curso',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
  fulfilled: 'Aceptado',
  pending: 'Pendiente',
  active_request: 'Solicitud',
}[status] || status || 'Programado');

const eventTypeLabel = (event) => {
  if (event.type === 'request') return 'Solicitud';
  return event.role === 'driver' ? 'Conduces' : 'Viajas';
};

const formatTime = (value) => {
  try {
    return format(new Date(value), 'HH:mm');
  } catch {
    return '--:--';
  }
};

const parseLocalDateKey = (value) => {
  try {
    return parseISO(value);
  } catch {
    return new Date();
  }
};

function EventCard({ event, compact = false }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(event.actionUrl)}
      className={cn(
        'w-full rounded-3xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-all hover:shadow-xl active:scale-[0.99]',
        compact && 'rounded-2xl p-3',
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'flex shrink-0 items-center justify-center rounded-2xl',
          compact ? 'h-9 w-9' : 'h-12 w-12',
          event.type === 'request' ? 'bg-orange-50 text-orange-500' : event.role === 'driver' ? 'bg-slate-900 text-white' : 'bg-primary/10 text-primary',
        )}>
          {event.type === 'request' ? <Search className="h-5 w-5" /> : <Car className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{eventTypeLabel(event)}</p>
            <span className="text-xs font-black text-slate-900">{formatTime(event.startsAt)}</span>
          </div>
          <h3 className={cn('mt-1 line-clamp-1 font-black tracking-tight text-slate-900', compact ? 'text-sm' : 'text-base')}>{event.title}</h3>
          {!compact && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest', STATUS_STYLES[event.status] || STATUS_STYLES.scheduled)}>
                {statusLabel(event.status)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                <Users className="h-3 w-3" /> {event.seats} plaza{Number(event.seats) === 1 ? '' : 's'}
              </span>
              {event.price > 0 && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-600">{Number(event.price).toFixed(2)}€ / plaza</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function TripCalendarPage() {
  const { user } = useOutletContext();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getLocalDateKey(new Date()));
  const navigate = useNavigate();

  const monthRange = useMemo(() => ({
    from: startOfMonth(currentMonth).toISOString(),
    to: endOfMonth(currentMonth).toISOString(),
  }), [currentMonth]);

  useEffect(() => {
    let mounted = true;

    const loadEvents = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const data = await getTripCalendarEvents(user.id, monthRange);
        if (mounted) setEvents(data);
      } catch (error) {
        console.error('[TripCalendarPage] load failed:', error);
        toast.error('No se pudo cargar el calendario');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadEvents();
    return () => { mounted = false; };
  }, [monthRange, user?.id]);

  const groupedEvents = useMemo(() => groupEventsByDate(events), [events]);
  const upcomingEvents = useMemo(() => getUpcomingEvents(events, 6), [events]);
  const selectedEvents = groupedEvents[selectedDate] || [];
  const selectedDateObject = useMemo(() => parseLocalDateKey(selectedDate), [selectedDate]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const result = [];
    let cursor = start;
    while (cursor <= end) {
      result.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return result;
  }, [currentMonth]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 pb-32 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm lg:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Agenda ShareWay</p>
              <h1 className="mt-1 text-3xl font-black uppercase italic tracking-tighter text-slate-900">Calendario de viajes</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
                Consulta tus viajes como conductor, tus reservas como pasajero y tus solicitudes activas desde una única vista.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => navigate('/publish')} className="h-12 rounded-2xl bg-primary px-4 text-xs font-black uppercase tracking-normal text-white gap-2">
                <Plus className="h-4 w-4" /> Publicar
              </Button>
              <Button onClick={() => navigate('/request')} variant="outline" className="h-12 rounded-2xl px-4 text-xs font-black uppercase tracking-normal gap-2">
                <Search className="h-4 w-4" /> Solicitar
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-3xl border-none bg-white shadow-xl overflow-hidden">
            <CardContent className="p-4 sm:p-4 lg:p-8">
              <div className="mb-6 flex items-center justify-between gap-3">
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth((date) => subMonths(date, 1))} className="rounded-2xl">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                  <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-900">{format(currentMonth, 'MMMM yyyy', { locale: es })}</h2>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{events.length} evento{events.length === 1 ? '' : 's'} este mes</p>
                </div>
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth((date) => addMonths(date, 1))} className="rounded-2xl">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 sm:gap-2">
                {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day) => <div key={day} className="py-2">{day}</div>)}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-2">
                {days.map((day) => {
                  const key = getLocalDateKey(day);
                  const dayEvents = groupedEvents[key] || [];
                  const active = key === selectedDate;
                  const inMonth = isSameMonth(day, currentMonth);

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDate(key)}
                      className={cn(
                        'min-h-[72px] rounded-2xl border p-2 text-left transition-all active:scale-95 sm:min-h-[92px]',
                        active ? 'border-primary bg-primary/10 shadow-lg' : 'border-slate-100 bg-slate-50 hover:bg-white hover:shadow-sm',
                        !inMonth && 'opacity-40',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn('text-xs font-black', active ? 'text-primary' : 'text-slate-700')}>{format(day, 'd')}</span>
                        {dayEvents.length > 0 && (
                          <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[9px] font-black text-white">{dayEvents.length}</span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        {dayEvents.slice(0, 2).map((event) => (
                          <div key={`${event.type}-${event.id}`} className={cn(
                            'h-1.5 rounded-full',
                            event.type === 'request' ? 'bg-orange-400' : event.role === 'driver' ? 'bg-slate-900' : 'bg-primary',
                          )} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-3xl border-none bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] text-white shadow-xl overflow-hidden">
              <CardContent className="p-4 lg:p-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
                    <CalendarDays className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">Próximo día seleccionado</p>
                    <h2 className="text-xl font-black uppercase italic tracking-tighter">{format(selectedDateObject, "d 'de' MMMM", { locale: es })}</h2>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {loading && <div className="flex items-center gap-2 rounded-2xl bg-white/10 p-4 text-sm font-bold text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Cargando agenda...</div>}
                  {!loading && selectedEvents.length === 0 && (
                    <div className="rounded-3xl border border-white/10 bg-white/10 p-6 text-center">
                      <Clock className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                      <p className="text-sm font-black uppercase tracking-tight text-white">Sin viajes este día</p>
                      <p className="mt-1 text-xs font-medium text-slate-400">Puedes publicar o solicitar un trayecto.</p>
                    </div>
                  )}
                  {!loading && selectedEvents.map((event) => (
                    <EventCard key={`${event.type}-${event.id}`} event={event} compact />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-none bg-white shadow-xl">
              <CardContent className="p-4 lg:p-8">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Agenda rápida</p>
                    <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-900">Próximos viajes</h2>
                  </div>
                  <MapPin className="h-5 w-5 text-primary" />
                </div>

                <div className="space-y-3">
                  {loading && <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Cargando...</div>}
                  {!loading && upcomingEvents.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                      <p className="text-sm font-black text-slate-800">No tienes próximos viajes</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Cuando publiques o reserves, aparecerán aquí.</p>
                    </div>
                  )}
                  {!loading && upcomingEvents.map((event) => (
                    <EventCard key={`${event.type}-${event.id}`} event={event} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}