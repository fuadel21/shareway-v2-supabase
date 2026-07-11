import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, ExternalLink, Loader2, MousePointerClick, RefreshCw, Route, Search, UserPlus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { supabase } from '@/lib/supabase.js';

const EVENTS_LIMIT = 5000;
const RANGE_OPTIONS = [7, 30, 90];

const formatNumber = (value) => new Intl.NumberFormat('es-ES').format(value || 0);

const getPageTypeLabel = (pageType) => ({
  home: 'Home',
  route: 'Ruta',
  city: 'Ciudad',
  airport: 'Aeropuerto',
  guide: 'Guía',
  seo_landing: 'Landing SEO',
  app: 'App',
}[pageType] || pageType || 'Sin tipo');

const csvEscape = (value) => {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
};

const downloadCsv = (filename, rows) => {
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const aggregateRows = (items, keyGetter, valueBuilder) => {
  const map = new Map();

  items.forEach((item) => {
    const key = keyGetter(item);
    if (!key) return;

    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.lastSeen || item.created_at > existing.lastSeen) existing.lastSeen = item.created_at;
    } else {
      map.set(key, {
        ...valueBuilder(item),
        count: 1,
        lastSeen: item.created_at,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)));
};

const MetricCard = ({ title, value, description, icon }) => (
  <Card className="rounded-[2rem] border-none bg-white shadow-sm">
    <CardContent className="flex items-center justify-between gap-4 p-5">
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">{title}</p>
        <p className="mt-2 text-3xl font-black tracking-tighter text-slate-950">{formatNumber(value)}</p>
        {description && <p className="mt-1 text-[10px] font-bold uppercase tracking-tight text-slate-400">{description}</p>}
      </div>
      <div className="rounded-2xl bg-orange-50 p-3 text-orange-500">{icon}</div>
    </CardContent>
  </Card>
);

const EmptyState = ({ text = 'Sin datos todavía' }) => (
  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
    <p className="text-xs font-black uppercase tracking-widest text-slate-400">{text}</p>
  </div>
);

const SimpleTable = ({ title, description, rows, columns, limit = 10 }) => (
  <Card className="rounded-[2rem] border-none shadow-sm">
    <CardHeader className="p-5 pb-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base font-black uppercase tracking-tight text-slate-900">{title}</CardTitle>
          {description && <CardDescription className="text-xs font-bold text-slate-400">{description}</CardDescription>}
        </div>
        {rows.length > 0 && <Badge className="w-fit rounded-full bg-slate-100 text-slate-600 hover:bg-slate-100">Top {Math.min(limit, rows.length)}</Badge>}
      </div>
    </CardHeader>
    <CardContent className="p-5 pt-0">
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-100">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="px-4 py-3">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, limit).map((row, index) => (
                <tr key={`${title}-${index}`} className="hover:bg-slate-50/80">
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3 align-top">
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardContent>
  </Card>
);

const PathLink = ({ path }) => {
  if (!path) return <span className="text-slate-400">—</span>;

  return (
    <a href={path} target="_blank" rel="noreferrer" className="inline-flex max-w-[360px] items-center gap-2 truncate font-black text-slate-800 hover:text-orange-500">
      <span className="truncate">{path}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
};

function SeoAnalyticsTab() {
  const [events, setEvents] = useState([]);
  const [dayRange, setDayRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    const since = new Date(Date.now() - dayRange * 24 * 60 * 60 * 1000).toISOString();

    const { data, error: fetchError } = await supabase
      .from('growth_events')
      .select('event_name,path,metadata,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(EVENTS_LIMIT);

    if (fetchError) {
      setError(fetchError.message || 'No se pudieron cargar los eventos SEO');
      setEvents([]);
    } else {
      setEvents(data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchEvents();
  }, [dayRange]);

  const analytics = useMemo(() => {
    const pageViews = events.filter((event) => event.event_name === 'page_view');
    const seoClicks = events.filter((event) => event.event_name?.startsWith('seo_') && event.event_name.endsWith('_click'));
    const ctaClicks = events.filter((event) => event.event_name === 'seo_cta_click');
    const routeClicks = events.filter((event) => event.event_name === 'seo_route_click');
    const guideClicks = events.filter((event) => event.event_name === 'seo_guide_click');

    const topPages = aggregateRows(
      pageViews,
      (event) => `${event.path || 'sin-path'}|${event.metadata?.pageType || 'sin-tipo'}`,
      (event) => ({
        path: event.path || 'sin-path',
        pageType: event.metadata?.pageType || 'sin-tipo',
      })
    );

    const topClicks = aggregateRows(
      seoClicks,
      (event) => `${event.event_name}|${event.metadata?.sourcePath || ''}|${event.metadata?.targetPath || ''}|${event.metadata?.targetText || ''}`,
      (event) => ({
        eventName: event.event_name,
        sourcePath: event.metadata?.sourcePath || null,
        targetPath: event.metadata?.targetPath || null,
        targetText: event.metadata?.targetText || null,
      })
    );

    const guideToRoute = aggregateRows(
      routeClicks.filter((event) => event.metadata?.sourcePageType === 'guide'),
      (event) => `${event.metadata?.sourcePath || ''}|${event.metadata?.targetPath || ''}`,
      (event) => ({
        guide: event.metadata?.sourcePath || null,
        route: event.metadata?.targetPath || null,
      })
    );

    const registrationClicks = aggregateRows(
      ctaClicks.filter((event) => ['/register', '/login'].includes(event.metadata?.targetPath)),
      (event) => `${event.metadata?.sourcePath || ''}|${event.metadata?.sourcePageType || ''}|${event.metadata?.targetText || ''}`,
      (event) => ({
        sourcePath: event.metadata?.sourcePath || null,
        sourcePageType: event.metadata?.sourcePageType || null,
        targetText: event.metadata?.targetText || null,
      })
    );

    return {
      pageViews,
      seoClicks,
      ctaClicks,
      routeClicks,
      guideClicks,
      topPages,
      topClicks,
      guideToRoute,
      registrationClicks,
    };
  }, [events]);

  const handleExportCsv = () => {
    const header = [
      'created_at',
      'event_name',
      'path',
      'page_type',
      'source_path',
      'source_page_type',
      'target_path',
      'target_text',
      'metadata',
    ];

    const rows = events.map((event) => [
      event.created_at,
      event.event_name,
      event.path,
      event.metadata?.pageType,
      event.metadata?.sourcePath,
      event.metadata?.sourcePageType,
      event.metadata?.targetPath,
      event.metadata?.targetText,
      JSON.stringify(event.metadata || {}),
    ].map(csvEscape).join(','));

    const csv = [header.map(csvEscape).join(','), ...rows].join('\n');
    downloadCsv(`shareway-seo-events-${dayRange}d.csv`, csv);
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[2rem] bg-slate-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-orange-500" />
          <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-400">Cargando analítica SEO...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[2rem] bg-slate-950 p-6 text-white xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-300">SEO Analytics</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight">Rendimiento SEO de los últimos {dayRange} días</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Mide visitas, clics internos, guías que empujan hacia rutas y páginas que generan intención de registro.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/10 p-1.5">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setDayRange(days)}
                className={days === dayRange ? 'rounded-xl bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-950' : 'rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest text-white/70 hover:bg-white/10'}
              >
                {days}d
              </button>
            ))}
          </div>
          <Button onClick={fetchEvents} variant="secondary" className="rounded-2xl font-black uppercase tracking-widest">
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
          <Button onClick={handleExportCsv} disabled={events.length === 0} className="rounded-2xl bg-orange-500 font-black uppercase tracking-widest text-white hover:bg-orange-600">
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-3xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Page views" value={analytics.pageViews.length} description={`Visitas últimos ${dayRange} días`} icon={<BarChart3 className="h-5 w-5" />} />
        <MetricCard title="Clics SEO" value={analytics.seoClicks.length} description="Clics internos medidos" icon={<MousePointerClick className="h-5 w-5" />} />
        <MetricCard title="Guía → Ruta" value={analytics.guideToRoute.reduce((sum, row) => sum + row.count, 0)} description="Clics desde guías" icon={<Route className="h-5 w-5" />} />
        <MetricCard title="Registro/Login" value={analytics.registrationClicks.reduce((sum, row) => sum + row.count, 0)} description="Intención de conversión" icon={<UserPlus className="h-5 w-5" />} />
      </div>

      <SimpleTable
        title="Top páginas visitadas"
        description="Equivale a la consulta de páginas SEO más visitadas."
        rows={analytics.topPages}
        columns={[
          { key: 'path', label: 'Página', render: (row) => <PathLink path={row.path} /> },
          { key: 'pageType', label: 'Tipo', render: (row) => <Badge className="rounded-full bg-slate-100 text-slate-700 hover:bg-slate-100">{getPageTypeLabel(row.pageType)}</Badge> },
          { key: 'count', label: 'Visitas', render: (row) => <span className="font-black">{formatNumber(row.count)}</span> },
        ]}
      />

      <SimpleTable
        title="Clics SEO más importantes"
        description="Muestra qué enlaces internos reciben más clics."
        rows={analytics.topClicks}
        columns={[
          { key: 'eventName', label: 'Evento', render: (row) => <Badge className="rounded-full bg-orange-50 text-orange-600 hover:bg-orange-50">{row.eventName}</Badge> },
          { key: 'sourcePath', label: 'Origen', render: (row) => <PathLink path={row.sourcePath} /> },
          { key: 'targetPath', label: 'Destino', render: (row) => <PathLink path={row.targetPath} /> },
          { key: 'targetText', label: 'Texto', render: (row) => <span className="font-bold text-slate-600">{row.targetText || '—'}</span> },
          { key: 'count', label: 'Clics', render: (row) => <span className="font-black">{formatNumber(row.count)}</span> },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <SimpleTable
          title="Guías que mandan usuarios a rutas"
          description="Embudo guía → ruta."
          rows={analytics.guideToRoute}
          columns={[
            { key: 'guide', label: 'Guía', render: (row) => <PathLink path={row.guide} /> },
            { key: 'route', label: 'Ruta', render: (row) => <PathLink path={row.route} /> },
            { key: 'count', label: 'Clics', render: (row) => <span className="font-black">{formatNumber(row.count)}</span> },
          ]}
        />

        <SimpleTable
          title="Clics hacia registro"
          description="Páginas que empujan a crear cuenta o entrar."
          rows={analytics.registrationClicks}
          columns={[
            { key: 'sourcePath', label: 'Origen', render: (row) => <PathLink path={row.sourcePath} /> },
            { key: 'sourcePageType', label: 'Tipo', render: (row) => <Badge className="rounded-full bg-slate-100 text-slate-700 hover:bg-slate-100">{getPageTypeLabel(row.sourcePageType)}</Badge> },
            { key: 'targetText', label: 'Botón', render: (row) => <span className="font-bold text-slate-600">{row.targetText || '—'}</span> },
            { key: 'count', label: 'Clics', render: (row) => <span className="font-black">{formatNumber(row.count)}</span> },
          ]}
        />
      </div>

      <Card className="rounded-[2rem] border-none bg-orange-50 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <Search className="mt-1 h-5 w-5 shrink-0 text-orange-500" />
            <div>
              <h4 className="font-black text-slate-950">Cómo usar estos datos</h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">Usa 7 días para ver cambios recientes, 30 días para tomar decisiones normales y 90 días para detectar tendencias. Si una guía tiene visitas pero pocos clics a ruta, mejora el CTA. Si una ruta tiene muchos clics a registro, crea más guías alrededor de esa ruta.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SeoAnalyticsTab;
