import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Gift, Loader2, MousePointerClick, TrendingUp, UserPlus, Users } from 'lucide-react';
import { Card } from '@/components/ui/card.jsx';
import { supabase } from '@/lib/supabase.js';

const StatCard = ({ icon: Icon, label, value, hint }) => (
  <Card className="rounded-3xl border-none bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <p className="mt-2 text-3xl font-black tracking-tighter text-slate-950">{value}</p>
        {hint && <p className="mt-1 text-xs font-bold text-slate-400">{hint}</p>}
      </div>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </Card>
);

const GrowthAnalytics = () => {
  const [daily, setDaily] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadAnalytics = async () => {
      setLoading(true);
      setError(null);
      try {
        const [dailyRes, referralRes] = await Promise.all([
          supabase.from('growth_daily_summary').select('*').limit(30),
          supabase.from('growth_referral_summary').select('*').limit(20),
        ]);

        if (dailyRes.error) throw dailyRes.error;
        if (referralRes.error) throw referralRes.error;

        setDaily(dailyRes.data || []);
        setReferrals(referralRes.data || []);
      } catch (err) {
        console.error('[GrowthAnalytics] load failed', err);
        setError(err.message || 'No se pudo cargar Growth Analytics');
      } finally {
        setLoading(false);
      }
    };

    loadAnalytics();
  }, []);

  const totals = useMemo(() => daily.reduce((acc, row) => ({
    pageViews: acc.pageViews + Number(row.page_views || 0),
    signups: acc.signups + Number(row.signups || 0),
    activeUsers: Math.max(acc.activeUsers, Number(row.active_users || 0)),
    inviteViews: acc.inviteViews + Number(row.invite_views || 0),
    referralShares: acc.referralShares + Number(row.referral_shares || 0),
    ridesCreated: acc.ridesCreated + Number(row.rides_created || 0),
    bookingsCompleted: acc.bookingsCompleted + Number(row.bookings_completed || 0),
  }), {
    pageViews: 0,
    signups: 0,
    activeUsers: 0,
    inviteViews: 0,
    referralShares: 0,
    ridesCreated: 0,
    bookingsCompleted: 0,
  }), [daily]);

  const conversionRate = totals.pageViews > 0 ? ((totals.signups / totals.pageViews) * 100).toFixed(1) : '0.0';

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8 p-4 md:p-8">
      <header className="rounded-3xl bg-slate-950 p-7 text-white shadow-2xl">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-300">Centro de Mando</p>
        <h1 className="mt-2 text-3xl font-black tracking-tighter md:text-5xl">Growth Analytics</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">Métricas de adquisición, referidos, conversión y actividad para tomar decisiones de crecimiento.</p>
      </header>

      {error && (
        <Card className="rounded-3xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-600">
          {error}
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={MousePointerClick} label="Page views 30d" value={totals.pageViews} hint="Visitas registradas" />
        <StatCard icon={UserPlus} label="Registros 30d" value={totals.signups} hint={`${conversionRate}% conversión`} />
        <StatCard icon={Users} label="Usuarios activos" value={totals.activeUsers} hint="Máximo diario" />
        <StatCard icon={Gift} label="Referidos" value={totals.inviteViews} hint={`${totals.referralShares} compartidos`} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-3xl border-none bg-white p-4 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-orange-500" />
            <h2 className="text-xl font-black tracking-tight">Resumen diario</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="py-3">Día</th>
                  <th>Views</th>
                  <th>Registros</th>
                  <th>Rides</th>
                  <th>Reservas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                {daily.slice(0, 12).map((row) => (
                  <tr key={row.day}>
                    <td className="py-3">{row.day}</td>
                    <td>{row.page_views || 0}</td>
                    <td>{row.signups || 0}</td>
                    <td>{row.rides_created || 0}</td>
                    <td>{row.bookings_completed || 0}</td>
                  </tr>
                ))}
                {daily.length === 0 && <tr><td colSpan="5" className="py-6 text-center text-slate-400">Sin datos todavía</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="rounded-3xl border-none bg-white p-4 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            <h2 className="text-xl font-black tracking-tight">Ranking de referidos</h2>
          </div>
          <div className="space-y-3">
            {referrals.map((row) => (
              <div key={row.referral_code} className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-950">{row.referral_code}</p>
                  <span className="rounded-full bg-orange-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-orange-600">{row.signups || 0} registros</span>
                </div>
                <p className="mt-2 text-xs font-bold text-slate-400">{row.invite_views || 0} visitas · {row.shares || 0} compartidos</p>
              </div>
            ))}
            {referrals.length === 0 && <p className="py-8 text-center text-sm font-bold text-slate-400">Sin referidos todavía</p>}
          </div>
        </Card>
      </section>
    </div>
  );
};

export default GrowthAnalytics;
