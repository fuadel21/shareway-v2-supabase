import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import SubPageHeader from './SubPageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Plus, Route, Trash2, Edit, Loader2, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const weekDaysMap = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
const weekDaysMapEn = { 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S', 0: 'S' };

const FavoriteRoutes = () => {
    const navigate = useNavigate();
    const { profile } = useOutletContext();
    const { t, i18n } = useTranslation();
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(null);

    const fetchRoutes = useCallback(async () => {
        if (!profile?.id) return;
        try {
            const { data, error } = await supabase
                .from('favorite_routes')
                .select('*')
                .eq('user_id', profile.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setRoutes(data || []);
        } catch (error) {
            console.error("Error fetching favorite routes: ", error);
            toast.error(t('favorite_routes.fetch_error'));
        } finally {
            setLoading(false);
        }
    }, [profile?.id, t]);

    useEffect(() => {
        fetchRoutes();

        if (profile?.id) {
            const channel = supabase
                .channel(`fav_routes_${profile.id}`)
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'favorite_routes', filter: `user_id=eq.${profile.id}` },
                    fetchRoutes
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [profile?.id, fetchRoutes]);

    const handleDelete = async (routeId) => {
        if (!window.confirm(t('favorite_routes.delete_confirm'))) return;
        setIsDeleting(routeId);
        try {
            const { error } = await supabase
                .from('favorite_routes')
                .delete()
                .eq('id', routeId);

            if (error) throw error;
            toast.success(t('favorite_routes.delete_success'));
        } catch (error) {
            console.error("Error deleting route:", error);
            toast.error(t('favorite_routes.delete_error'));
        } finally {
            setIsDeleting(null);
        }
    };

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{t('favorite_routes.syncing')}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <SubPageHeader title={t('favorite_routes.title')} backTo="/settings" />
            <main className="container mx-auto p-4 max-w-3xl pb-24">
                <div className="flex justify-between items-center mb-8">
                    <div className="text-left">
                        <h2 className="text-2xl font-black text-gray-800 tracking-tight">{t('favorite_routes.header_title')}</h2>
                        <p className="text-gray-500 text-sm font-medium">{t('favorite_routes.header_subtitle')}</p>
                    </div>
                    <Button onClick={() => navigate('/edit-favorite-route/new')} className="rounded-2xl h-12 px-6 font-bold shadow-lg shadow-primary/20 bg-primary">
                        <Plus className="mr-2 h-5 w-5" /> {t('favorite_routes.add_new')}
                    </Button>
                </div>

                {routes.length > 0 ? (
                    <div className="grid gap-6">
                        {routes.map(route => (
                            <Card key={route.id} className="rounded-[2rem] border-none shadow-xl shadow-blue-500/5 hover:shadow-blue-500/10 transition-all group overflow-hidden bg-white/80 backdrop-blur-sm text-left">
                                <CardHeader className="pb-4">
                                    <div className="flex justify-between items-start">
                                        <div className="flex gap-4">
                                            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                                <Route className="h-6 w-6" />
                                            </div>
                                            <div className="text-left">
                                                <CardTitle className="text-xl font-black text-gray-800">{route.name}</CardTitle>
                                                <CardDescription className="font-medium mt-1 line-clamp-2 text-left">
                                                    <span className="text-primary font-bold">{t('favorite_routes.from')}:</span> {route.origin.address} <br />
                                                    <span className="text-primary font-bold">{t('favorite_routes.to')}:</span> {route.destination.address}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="ghost" size="icon" className="rounded-xl hover:bg-primary/10 hover:text-primary transition-colors" onClick={() => navigate(`/edit-favorite-route/${route.id}`)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="rounded-xl text-gray-300 hover:text-destructive hover:bg-destructive/10 transition-colors" onClick={() => handleDelete(route.id)} disabled={isDeleting === route.id}>
                                                {isDeleting === route.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <div className="flex items-center gap-3 bg-gray-50/50 p-3 rounded-2xl border border-gray-100/50">
                                        <Calendar className="h-4 w-4 text-gray-400" />
                                        <div className="flex gap-1.5">
                                            {[1, 2, 3, 4, 5, 6, 0].map(d => (
                                                <span
                                                    key={d}
                                                    className={`w-7 h-7 flex items-center justify-center text-[10px] font-black rounded-lg transition-all ${(route.days || []).includes(d)
                                                        ? 'bg-primary text-white shadow-sm shadow-primary/30'
                                                        : 'bg-white text-gray-300 border border-gray-100'
                                                        }`}
                                                >
                                                    {i18n.language === 'es' ? weekDaysMap[d] : weekDaysMapEn[d]}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white/50 backdrop-blur-sm rounded-[3rem] border-2 border-dashed border-gray-200">
                        <div className="bg-gray-100 h-20 w-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                            <Route className="h-10 w-10 text-gray-400" />
                        </div>
                        <h3 className="text-xl font-black text-gray-800 tracking-tight">{t('favorite_routes.no_routes_title')}</h3>
                        <p className="mt-2 text-gray-500 font-medium max-w-xs mx-auto">{t('favorite_routes.no_routes_description')}</p>
                        <div className="mt-8">
                            <Button onClick={() => navigate('/edit-favorite-route/new')} className="rounded-2xl h-12 px-8 font-bold shadow-xl shadow-primary/20 bg-primary">
                                <Plus className="mr-2 h-5 w-5" /> {t('favorite_routes.create_first')}
                            </Button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default FavoriteRoutes;
