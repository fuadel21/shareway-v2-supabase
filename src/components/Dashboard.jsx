import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import 'leaflet-defaulticon-compatibility';
import { supabase } from '../lib/supabase';
import { isValid, isAfter, subMinutes, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    Plus, Search, Car, Loader2, Calendar, Leaf, Sparkles, Navigation,
    Megaphone, Clock, Activity, Star, ShieldCheck, Heart, ChevronRight, X,
    BadgeCheck, MapPin, Users, RotateCcw, ArrowRightLeft, SlidersHorizontal,
    WalletCards, MessageCircle, AlertCircle
} from 'lucide-react';
import { getAvailableRides } from '@/services/rideService';
import AddressAutocomplete from './AddressAutocomplete';
import MapComponent from './MapComponent';
import { DraggableSheet } from './DraggableSheet';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        positiveImpact: 'Impacto Positivo',
        user: 'Usuario',
        passenger: 'Pasajero',
        driver: 'Conductor',
        freeSeats: 'plazas libres',
        origin: 'Origen',
        destination: 'Destino',
        request: 'SOLICITUD',
        details: 'DETALLES',
        syncMapError: 'Error al sincronizar mapa',
        activitySyncError: 'No se pudo cargar tu actividad',
        nearbyScanned: 'Viajes cercanos escaneados',
        locationError: 'No se pudo obtener ubicación',
        detailOpenError: 'No se pudo abrir el detalle: ID no encontrado',
        nearMe: 'CERCA DE TI',
        nearYouTitle: 'Cerca de ti',
        noNearbyResults: 'Sin resultados cerca',
        seatPrice: 'Precio Plaza',
        viewRequest: 'Ver Solicitud',
        viewDetails: 'Ver Detalles',
        searchTitle: 'Buscar viaje',
        searchSubtitle: 'Encuentra una ruta real antes de publicar',
        fromPlaceholder: '¿De dónde sales?',
        toPlaceholder: '¿A dónde vas?',
        dateLabel: 'Fecha',
        seatsLabel: 'Plazas',
        searchButton: 'Buscar viajes',
        clearSearch: 'Limpiar',
        activeSearch: 'Búsqueda activa',
        matchingResults: 'resultados encontrados',
        noSearchResults: 'No encontramos viajes para esta búsqueda',
        noSearchResultsDesc: 'Publica una solicitud y los conductores podrán encontrarte.',
        createRequest: 'Crear solicitud',
        publishRide: 'Publicar viaje',
        anyDate: 'Cualquier fecha',
        anyRoute: 'Todas las rutas',
        searchHint: 'Origen, destino o fecha ayudan a encontrar mejores coincidencias.',
        swap: 'Invertir ruta',
        activityTitle: 'Tu actividad ahora',
        activitySubtitle: 'Reservas, solicitudes y viajes en una vista rápida',
        nextRide: 'Próximo viaje',
        activeRides: 'En curso',
        pendingRequests: 'Solicitudes',
        openRequests: 'Tus búsquedas',
        pendingPayments: 'Pagos',
        noActivity: 'Sin actividad pendiente',
        noActivityDesc: 'Busca un viaje, publica ruta o crea una solicitud.',
        goToMyRides: 'Mis viajes',
        goToRequests: 'Solicitudes',
        goToWallet: 'Billetera',
        refresh: 'Actualizar'
    },
    en: {
        positiveImpact: 'Positive Impact',
        user: 'User',
        passenger: 'Passenger',
        driver: 'Driver',
        freeSeats: 'free seats',
        origin: 'Origin',
        destination: 'Destination',
        request: 'REQUEST',
        details: 'DETAILS',
        syncMapError: 'Error syncing map',
        activitySyncError: 'Could not load your activity',
        nearbyScanned: 'Nearby rides scanned',
        locationError: 'Could not get location',
        detailOpenError: 'Could not open details: ID not found',
        nearMe: 'NEAR ME',
        nearYouTitle: 'Near you',
        noNearbyResults: 'No nearby results',
        seatPrice: 'Seat Price',
        viewRequest: 'View Request',
        viewDetails: 'View Details',
        searchTitle: 'Find a ride',
        searchSubtitle: 'Find a real route before posting',
        fromPlaceholder: 'Where are you leaving from?',
        toPlaceholder: 'Where are you going?',
        dateLabel: 'Date',
        seatsLabel: 'Seats',
        searchButton: 'Search rides',
        clearSearch: 'Clear',
        activeSearch: 'Active search',
        matchingResults: 'results found',
        noSearchResults: 'No rides found for this search',
        noSearchResultsDesc: 'Post a request so drivers can find you.',
        createRequest: 'Create request',
        publishRide: 'Publish ride',
        anyDate: 'Any date',
        anyRoute: 'All routes',
        searchHint: 'Origin, destination or date help find better matches.',
        swap: 'Swap route',
        activityTitle: 'Your activity now',
        activitySubtitle: 'Bookings, requests and rides at a glance',
        nextRide: 'Next ride',
        activeRides: 'In progress',
        pendingRequests: 'Requests',
        openRequests: 'Your searches',
        pendingPayments: 'Payments',
        noActivity: 'No pending activity',
        noActivityDesc: 'Find a ride, publish a route or create a request.',
        goToMyRides: 'My rides',
        goToRequests: 'Requests',
        goToWallet: 'Wallet',
        refresh: 'Refresh'
    },
    ar: {
        positiveImpact: 'أثر إيجابي',
        user: 'مستخدم',
        passenger: 'راكب',
        driver: 'سائق',
        freeSeats: 'مقاعد متاحة',
        origin: 'نقطة الانطلاق',
        destination: 'الوجهة',
        request: 'طلب',
        details: 'التفاصيل',
        syncMapError: 'حدث خطأ أثناء مزامنة الخريطة',
        activitySyncError: 'تعذر تحميل نشاطك',
        nearbyScanned: 'تم فحص الرحلات القريبة',
        locationError: 'تعذر الحصول على الموقع',
        detailOpenError: 'تعذر فتح التفاصيل: لم يتم العثور على المعرف',
        nearMe: 'بالقرب مني',
        nearYouTitle: 'بالقرب منك',
        noNearbyResults: 'لا توجد نتائج قريبة',
        seatPrice: 'سعر المقعد',
        viewRequest: 'عرض الطلب',
        viewDetails: 'عرض التفاصيل',
        searchTitle: 'ابحث عن رحلة',
        searchSubtitle: 'اعثر على مسار حقيقي قبل النشر',
        fromPlaceholder: 'من أين تنطلق؟',
        toPlaceholder: 'إلى أين تذهب؟',
        dateLabel: 'التاريخ',
        seatsLabel: 'المقاعد',
        searchButton: 'بحث عن رحلات',
        clearSearch: 'مسح',
        activeSearch: 'بحث نشط',
        matchingResults: 'نتائج متاحة',
        noSearchResults: 'لا توجد رحلات لهذه المعايير',
        noSearchResultsDesc: 'أنشئ طلبًا ليتمكن السائقون من العثور عليك.',
        createRequest: 'إنشاء طلب',
        publishRide: 'نشر رحلة',
        anyDate: 'أي تاريخ',
        anyRoute: 'كل المسارات',
        searchHint: 'نقطة الانطلاق أو الوجهة أو التاريخ تساعد في نتائج أفضل.',
        swap: 'عكس المسار',
        activityTitle: 'نشاطك الآن',
        activitySubtitle: 'الحجوزات والطلبات والرحلات في لمحة واحدة',
        nextRide: 'الرحلة القادمة',
        activeRides: 'قيد التنفيذ',
        pendingRequests: 'الطلبات',
        openRequests: 'عمليات البحث',
        pendingPayments: 'المدفوعات',
        noActivity: 'لا يوجد نشاط معلق',
        noActivityDesc: 'ابحث عن رحلة أو انشر مسارًا أو أنشئ طلبًا.',
        goToMyRides: 'رحلاتي',
        goToRequests: 'الطلبات',
        goToWallet: 'المحفظة',
        refresh: 'تحديث'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const formatTime = (date, language) => {
    if (!date || !isValid(date)) return '--:--';
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date);
};

const formatShortDate = (date, language) => {
    if (!date || !isValid(date)) return '';
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(date);
};

const getLocationCoords = (location) => {
    const raw = location?.coordinates || location;
    const lat = Number(raw?.lat ?? raw?.latitude);
    const lng = Number(raw?.lng ?? raw?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

const getLocationLabel = (location, fallback = '') => {
    if (!location) return fallback;
    if (typeof location === 'string') return location;
    return location.name || location.address || location.formatted_address || fallback;
};

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const distanceKm = (a, b) => {
    if (!a || !b) return null;
    const radius = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const locationMatches = (target, candidate, maxKm = 45) => {
    if (!target) return true;
    if (!candidate) return false;

    const targetCoords = getLocationCoords(target);
    const candidateCoords = getLocationCoords(candidate);
    if (targetCoords && candidateCoords) return distanceKm(targetCoords, candidateCoords) <= maxKm;

    const targetText = normalizeText(getLocationLabel(target));
    const candidateText = normalizeText(getLocationLabel(candidate));
    if (!targetText || !candidateText) return false;
    return candidateText.includes(targetText) || targetText.includes(candidateText);
};

const isSameSearchDay = (departureTime, dateValue) => {
    if (!dateValue) return true;
    const departure = new Date(departureTime);
    const selected = new Date(`${dateValue}T00:00:00`);
    if (!isValid(departure) || !isValid(selected)) return true;
    return isSameDay(departure, selected);
};

const getSeatCount = (item) => Number(item.seats_available ?? item.available_seats ?? item.seats ?? item.seats_needed ?? 1);

const getSearchSummary = (search, copy) => {
    if (!search) return copy.anyRoute;
    const origin = getLocationLabel(search.origin, copy.origin);
    const destination = getLocationLabel(search.destination, copy.destination);
    const route = search.origin || search.destination ? `${origin} → ${destination}` : copy.anyRoute;
    const date = search.date || copy.anyDate;
    return `${route} · ${date} · ${search.seats} ${copy.seatsLabel.toLowerCase()}`;
};

const ImpactBadge = ({ profile, copy }) => {
    if (!profile) return null;
    const savedKg = parseFloat(profile.total_co2_saved) || 0;

    return (
        <div className="bg-slate-950/80 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 animate-elite-in pointer-events-none">
            <div className="size-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Leaf size={16} className="text-white" />
            </div>
            <div className="text-left leading-tight">
                <p className="text-xs font-black italic text-white tracking-widest uppercase">
                    {savedKg.toFixed(1)} <span className="text-emerald-400">KG CO₂</span>
                </p>
                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-0.5">{copy.positiveImpact}</p>
            </div>
        </div>
    );
};

const RideCard = ({ item, isSelected, onClick, copy, language }) => {
    const isRequest = item.type === 'request';
    const profile = isRequest ? item.requester : item.driver;
    const name = profile?.display_name || profile?.full_name || copy.user;
    const photo = profile?.avatar_url || profile?.photo_url;
    const departureDate = item.departure_time ? new Date(item.departure_time) : null;
    const totalSeats = Number(item.seats || item.seats_needed || 1);
    const availableSeats = item.seats_available ?? totalSeats;

    return (
        <div
            onClick={() => onClick(item)}
            className={cn(
                'group relative bg-white rounded-3xl p-4 mb-3 transition-all duration-300 cursor-pointer overflow-hidden border border-slate-100 shadow-elite animate-elite-in',
                isSelected ? 'ring-2 ring-primary ring-offset-1 z-10 shadow-xl' : 'hover:border-slate-200'
            )}
        >
            <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-20">
                {item.is_women_only && <div className="bg-pink-500 text-white p-1.5 rounded-full shadow-lg"><Heart size={10} className="fill-white" /></div>}
                {(profile?.is_verified || profile?.verification?.status === 'verified') && (
                    <div className="bg-blue-500 text-white p-1.5 rounded-full shadow-lg"><ShieldCheck size={10} /></div>
                )}
            </div>

            <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md shrink-0">
                        <AvatarImage src={photo} className="object-cover" />
                        <AvatarFallback className="font-bold bg-slate-100 text-slate-400">{name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left min-w-0">
                        <h3 className="truncate text-sm font-black text-slate-900 uppercase italic tracking-tighter leading-none">{name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-full border shadow-sm', isRequest ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100')}>
                                {isRequest ? copy.passenger : copy.driver}
                            </span>
                            {profile?.is_verified && <BadgeCheck size={14} className="text-blue-500" />}
                        </div>
                    </div>
                </div>
                <div className="text-right shrink-0 pl-2">
                    <p className="text-lg font-black text-primary tracking-tighter leading-none">{item.price || item.suggested_price || 0}€</p>
                    {!isRequest && <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">{availableSeats} {copy.freeSeats}</p>}
                </div>
            </div>

            <div className="space-y-2 py-3 border-y border-slate-50">
                <div className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tight truncate">{getLocationLabel(item.origin, copy.origin)}</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full bg-primary shrink-0" />
                    <p className="text-[11px] font-black text-slate-900 uppercase italic tracking-tight truncate">{getLocationLabel(item.destination, copy.destination)}</p>
                </div>
            </div>

            <div className="flex items-center justify-between pt-3">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-slate-400"><Clock size={12} /><span className="text-[10px] font-black text-slate-900">{formatTime(departureDate, language)}</span></div>
                    <div className="flex items-center gap-1.5 text-slate-400"><Calendar size={12} /><span className="text-[10px] font-bold text-slate-400">{formatShortDate(departureDate, language)}</span></div>
                </div>
                <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onClick(item, true); }}
                    className="h-10 px-5 rounded-xl text-[10px] font-black tracking-widest uppercase italic bg-slate-900 shadow-md transition-transform active:scale-95"
                >
                    {isRequest ? copy.request : copy.details}
                </Button>
            </div>
        </div>
    );
};

const SearchPanel = ({ copy, origin, destination, date, seats, activeSearch, resultCount, onOrigin, onDestination, onDate, onSeats, onSearch, onClear, onSwap, onCreateRequest, compact = false }) => (
    <div className={cn('bg-white/95 backdrop-blur-2xl border border-white/60 shadow-2xl ring-1 ring-black/5', compact ? 'rounded-[1.5rem] p-3' : 'rounded-[2rem] p-5 space-y-4')}>
        {!compact && (
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="size-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><SlidersHorizontal size={17} /></div>
                    <div>
                        <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 leading-none">{copy.searchTitle}</h2>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">{copy.searchSubtitle}</p>
                    </div>
                </div>
                {activeSearch && (
                    <Button type="button" variant="ghost" size="sm" onClick={onClear} className="rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 gap-1">
                        <RotateCcw size={13} /> {copy.clearSearch}
                    </Button>
                )}
            </div>
        )}

        <div className="grid gap-3">
            <div className="grid gap-2">
                <AddressAutocomplete label={copy.fromPlaceholder} onSelect={onOrigin} defaultValue={origin?.address || origin?.name} icon={<div className="size-2 rounded-full bg-emerald-500" />} />
                <div className="flex justify-center -my-1 relative z-10">
                    <button type="button" onClick={onSwap} className="size-8 rounded-full bg-slate-900 text-white shadow-xl flex items-center justify-center active:scale-90" aria-label={copy.swap}>
                        <ArrowRightLeft size={14} />
                    </button>
                </div>
                <AddressAutocomplete label={copy.toPlaceholder} onSelect={onDestination} defaultValue={destination?.address || destination?.name} icon={<div className="size-2 rounded-full bg-primary" />} />
            </div>

            <div className="grid grid-cols-[1fr_96px] gap-2">
                <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">{copy.dateLabel}</p>
                    <Input type="date" value={date} onChange={(e) => onDate(e.target.value)} className="h-9 border-none bg-transparent px-0 py-0 text-sm font-black text-slate-900 focus-visible:ring-0" />
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">{copy.seatsLabel}</p>
                    <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={() => onSeats(Math.max(1, seats - 1))} className="size-8 rounded-xl bg-white font-black text-slate-400 shadow-sm active:scale-90">-</button>
                        <span className="text-base font-black text-slate-900">{seats}</span>
                        <button type="button" onClick={() => onSeats(Math.min(8, seats + 1))} className="size-8 rounded-xl bg-white font-black text-slate-400 shadow-sm active:scale-90">+</button>
                    </div>
                </div>
            </div>

            <Button type="button" onClick={onSearch} className="h-13 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl gap-2 active:scale-95">
                <Search size={16} className="text-primary" /> {copy.searchButton}
            </Button>
        </div>

        {!compact && (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3">
                {activeSearch ? (
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[8px] font-black uppercase tracking-widest text-primary">{copy.activeSearch}</p>
                            <p className="truncate text-[11px] font-black text-slate-700 uppercase tracking-tight mt-1">{getSearchSummary(activeSearch, copy)}</p>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2 text-right shadow-sm shrink-0">
                            <p className="text-lg font-black text-slate-900 leading-none">{resultCount}</p>
                            <p className="text-[7px] font-black uppercase tracking-widest text-slate-400">{copy.matchingResults}</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-[10px] font-bold text-slate-400 leading-relaxed">{copy.searchHint}</p>
                )}
            </div>
        )}

        {!compact && activeSearch && resultCount === 0 && (
            <Button type="button" variant="outline" onClick={onCreateRequest} className="w-full h-12 rounded-2xl border-amber-100 bg-amber-50 text-amber-700 font-black uppercase tracking-widest text-[10px] gap-2">
                <Megaphone size={15} /> {copy.createRequest}
            </Button>
        )}
    </div>
);

const ActivitySummaryPanel = ({ copy, summary, loading, onRefresh, navigate }) => {
    const totalActivity = Number(summary?.upcoming_driver || 0)
        + Number(summary?.upcoming_passenger || 0)
        + Number(summary?.active_rides || 0)
        + Number(summary?.pending_requests || 0)
        + Number(summary?.my_open_requests || 0)
        + Number(summary?.pending_payments || 0);
    const nextRide = summary?.next_ride;
    const recentRequest = summary?.recent_request;

    const statCards = [
        { label: copy.activeRides, value: summary?.active_rides || 0, icon: Activity, action: '/my-rides', tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
        { label: copy.pendingRequests, value: summary?.pending_requests || 0, icon: MessageCircle, action: '/my-rides', tone: 'text-amber-600 bg-amber-50 border-amber-100' },
        { label: copy.openRequests, value: summary?.my_open_requests || 0, icon: Megaphone, action: '/my-requests', tone: 'text-blue-600 bg-blue-50 border-blue-100' },
        { label: copy.pendingPayments, value: summary?.pending_payments || 0, icon: WalletCards, action: '/wallet', tone: 'text-purple-600 bg-purple-50 border-purple-100' }
    ];

    return (
        <div className="rounded-[2rem] bg-slate-900 text-white p-5 shadow-2xl overflow-hidden relative">
            <div className="absolute -right-12 -top-12 size-40 rounded-full bg-primary/20 blur-2xl" />
            <div className="relative space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="size-10 rounded-2xl bg-white/10 text-primary flex items-center justify-center shrink-0">
                            <Activity size={18} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-black uppercase italic tracking-tighter leading-none">{copy.activityTitle}</h2>
                            <p className="text-[10px] font-bold text-white/45 uppercase tracking-widest mt-1 leading-relaxed">{copy.activitySubtitle}</p>
                        </div>
                    </div>
                    <Button type="button" variant="ghost" onClick={onRefresh} disabled={loading} className="h-10 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-[9px] font-black uppercase tracking-widest shrink-0">
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    </Button>
                </div>

                {nextRide ? (
                    <button type="button" onClick={() => navigate(`/ride/${nextRide.id}`)} className="w-full rounded-3xl bg-white/10 hover:bg-white/15 p-4 text-left transition-all active:scale-[0.99]">
                        <p className="text-[9px] font-black uppercase tracking-widest text-primary mb-2">{copy.nextRide}</p>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-black uppercase italic">{getLocationLabel(nextRide.origin, copy.origin)} → {getLocationLabel(nextRide.destination, copy.destination)}</p>
                                <p className="text-[10px] font-bold text-white/45 uppercase tracking-widest mt-1">{formatShortDate(new Date(nextRide.departure_time), 'es')} · {formatTime(new Date(nextRide.departure_time), 'es')}</p>
                            </div>
                            <ChevronRight className="size-5 text-primary shrink-0" />
                        </div>
                    </button>
                ) : recentRequest ? (
                    <button type="button" onClick={() => navigate(`/request/${recentRequest.id}`)} className="w-full rounded-3xl bg-white/10 hover:bg-white/15 p-4 text-left transition-all active:scale-[0.99]">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-300 mb-2">{copy.openRequests}</p>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-black uppercase italic">{getLocationLabel(recentRequest.origin, copy.origin)} → {getLocationLabel(recentRequest.destination, copy.destination)}</p>
                                <p className="text-[10px] font-bold text-white/45 uppercase tracking-widest mt-1">{recentRequest.status}</p>
                            </div>
                            <ChevronRight className="size-5 text-amber-300 shrink-0" />
                        </div>
                    </button>
                ) : totalActivity === 0 ? (
                    <div className="rounded-3xl bg-white/10 p-4 flex items-start gap-3">
                        <AlertCircle className="size-5 text-white/45 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-black uppercase italic">{copy.noActivity}</p>
                            <p className="text-[10px] font-bold text-white/45 uppercase tracking-widest mt-1 leading-relaxed">{copy.noActivityDesc}</p>
                        </div>
                    </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                    {statCards.map((card) => {
                        const Icon = card.icon;
                        return (
                            <button key={card.label} type="button" onClick={() => navigate(card.action)} className={cn('rounded-2xl border p-3 text-left transition-all active:scale-95', card.tone)}>
                                <Icon size={16} className="mb-2" />
                                <p className="text-xl font-black leading-none">{card.value}</p>
                                <p className="text-[8px] font-black uppercase tracking-widest opacity-70 mt-1">{card.label}</p>
                            </button>
                        );
                    })}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                    <Button type="button" onClick={() => navigate('/my-rides')} className="h-10 rounded-2xl bg-white text-slate-900 text-[9px] font-black uppercase tracking-widest">{copy.goToMyRides}</Button>
                    <Button type="button" onClick={() => navigate('/my-requests')} variant="outline" className="h-10 rounded-2xl bg-white/10 border-white/10 text-white text-[9px] font-black uppercase tracking-widest">{copy.goToRequests}</Button>
                    <Button type="button" onClick={() => navigate('/wallet')} variant="outline" className="h-10 rounded-2xl bg-white/10 border-white/10 text-white text-[9px] font-black uppercase tracking-widest">{copy.goToWallet}</Button>
                </div>
            </div>
        </div>
    );
};

function Dashboard() {
    const { user, profile } = useOutletContext();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const language = getLanguage(i18n.language);
    const copy = copyByLanguage[language];

    const [allData, setAllData] = useState([]);
    const [activitySummary, setActivitySummary] = useState(null);
    const [isActivityLoading, setIsActivityLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState('all');
    const [selectedItem, setSelectedItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapCenter, setMapCenter] = useState([40.416775, -3.703790]);
    const [zoom, setZoom] = useState(6);
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
    const [searchOrigin, setSearchOrigin] = useState(null);
    const [searchDestination, setSearchDestination] = useState(null);
    const [searchDate, setSearchDate] = useState('');
    const [searchSeats, setSearchSeats] = useState(1);
    const [activeSearch, setActiveSearch] = useState(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleResize = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const fetchActivitySummary = useCallback(async () => {
        if (!user?.id) return;
        setIsActivityLoading(true);
        try {
            const { data, error } = await supabase.rpc('fetch_user_activity_summary_v1', { p_user_id: user.id });
            if (error) throw error;
            setActivitySummary(data || null);
        } catch (error) {
            console.error('Activity summary error:', error);
            toast.error(copy.activitySyncError);
        } finally {
            setIsActivityLoading(false);
        }
    }, [user?.id, copy.activitySyncError]);

    const fetchData = useCallback(async () => {
        if (!user || !profile) return;
        setLoading(true);
        try {
            const marginTime = subMinutes(new Date(), 60).toISOString();
            const rides = await getAvailableRides();

            const { data: rawRequests } = await supabase
                .from('ride_requests')
                .select('*, requester:profiles!requester_id(*)')
                .eq('status', 'pending')
                .gte('departure_time', marginTime);

            const filteredRides = (rides || []).filter(r => {
                const isNotMine = r.driver_id !== user.id;
                const genderShield = !r.is_women_only || profile.gender === 'female';
                const isStatusValid = r.status === 'active' || isAfter(new Date(r.departure_time), subMinutes(new Date(), 30));
                return isNotMine && genderShield && isStatusValid;
            }).map(r => ({ ...r, type: 'ride' }));

            const filteredRequests = (rawRequests || []).filter(req => req.requester_id !== user.id).map(req => ({ ...req, type: 'request' }));
            setAllData([...filteredRides, ...filteredRequests].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time)));
        } catch (error) {
            console.error('Dashboard Sync Error:', error);
            toast.error(copy.syncMapError);
        } finally {
            setLoading(false);
        }
    }, [user, profile, copy.syncMapError]);

    useEffect(() => {
        fetchData();
        fetchActivitySummary();
        const ridesChannel = supabase
            .channel(`dashboard_sync_${user?.id || 'guest'}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => { fetchData(); fetchActivitySummary(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests' }, () => { fetchData(); fetchActivitySummary(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, () => fetchActivitySummary())
            .subscribe();

        return () => {
            supabase.removeChannel(ridesChannel);
        };
    }, [fetchData, fetchActivitySummary, user?.id]);

    const handleLocateMe = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((pos) => {
                const nextCenter = [pos.coords.latitude, pos.coords.longitude];
                setMapCenter(nextCenter);
                setZoom(14);
                toast.success(copy.nearbyScanned, { icon: <Sparkles className="h-4 w-4 text-primary" /> });
            }, () => toast.error(copy.locationError));
        }
    };

    const applySearch = () => {
        if (!searchOrigin && !searchDestination && !searchDate) toast.message(copy.searchHint);
        const search = { origin: searchOrigin, destination: searchDestination, date: searchDate, seats: searchSeats };
        setActiveSearch(search);
        setActiveFilter('rides');
        setSelectedItem(null);
        const nextCenter = getLocationCoords(searchOrigin || searchDestination);
        if (nextCenter) {
            setMapCenter([nextCenter.lat, nextCenter.lng]);
            setZoom(11);
        }
    };

    const clearSearch = () => {
        setActiveSearch(null);
        setSearchOrigin(null);
        setSearchDestination(null);
        setSearchDate('');
        setSearchSeats(1);
        setSelectedItem(null);
    };

    const swapRoute = () => {
        setSearchOrigin(searchDestination);
        setSearchDestination(searchOrigin);
    };

    const navigateToRequestWithSearch = () => {
        navigate('/request', {
            state: {
                origin: activeSearch?.origin || searchOrigin,
                destination: activeSearch?.destination || searchDestination,
                date: activeSearch?.date || searchDate,
                seats: activeSearch?.seats || searchSeats
            }
        });
    };

    const itemsToDisplay = useMemo(() => {
        let filtered = allData || [];
        if (activeFilter === 'rides') filtered = filtered.filter(i => i.type === 'ride');
        if (activeFilter === 'requests') filtered = filtered.filter(i => i.type === 'request');

        if (activeSearch) {
            filtered = filtered.filter((item) => {
                const originMatches = locationMatches(activeSearch.origin, item.origin, 55);
                const destinationMatches = locationMatches(activeSearch.destination, item.destination, 65);
                const dateMatches = isSameSearchDay(item.departure_time, activeSearch.date);
                const seatsMatch = item.type === 'request' || getSeatCount(item) >= Number(activeSearch.seats || 1);
                return originMatches && destinationMatches && dateMatches && seatsMatch;
            });
        }

        return filtered;
    }, [allData, activeFilter, activeSearch]);

    const handleSelection = (item, forceNavigate = false) => {
        if (!item) return;
        const itemId = item.id || item.ride_id || item.request_id;

        if (forceNavigate) {
            if (!itemId) {
                console.error('Error: navigation without valid ID', item);
                toast.error(copy.detailOpenError);
                return;
            }
            navigate(item.type === 'request' ? `/request/${itemId}` : `/ride/${itemId}`);
            return;
        }

        setSelectedItem(item);
        const coords = getLocationCoords(item.origin);
        if (coords) {
            setMapCenter([coords.lat, coords.lng]);
            setZoom(13);
        }
    };

    if (!profile) return null;

    const filters = [
        { id: 'all', label: t('dashboard.filter_all') },
        { id: 'rides', label: t('dashboard.filter_rides') },
        { id: 'requests', label: t('dashboard.filter_requests') }
    ];

    const searchPanelProps = {
        copy,
        origin: searchOrigin,
        destination: searchDestination,
        date: searchDate,
        seats: searchSeats,
        activeSearch,
        resultCount: itemsToDisplay.length,
        onOrigin: setSearchOrigin,
        onDestination: setSearchDestination,
        onDate: setSearchDate,
        onSeats: setSearchSeats,
        onSearch: applySearch,
        onClear: clearSearch,
        onSwap: swapRoute,
        onCreateRequest: navigateToRequestWithSearch
    };

    return (
        <div className="h-full w-full flex bg-slate-100 overflow-hidden font-sans text-left relative">
            <div className="absolute bottom-60 left-4 z-[40] pointer-events-none lg:top-24 lg:left-1/2 lg:-translate-x-1/2 animate-in fade-in zoom-in duration-1000">
                <ImpactBadge profile={profile} copy={copy} />
            </div>

            <div className="hidden lg:flex w-[420px] bg-white border-r border-slate-100 shadow-2xl flex-col z-50 animate-in slide-in-from-left duration-500">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary h-10 w-10 rounded-xl flex items-center justify-center shadow-lg shadow-primary/20"><Sparkles className="h-5 w-5 text-white" /></div>
                        <div><h2 className="text-lg font-black text-slate-900 tracking-tighter uppercase italic leading-none">{t('nav.explore')}</h2><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ShareWay Global</p></div>
                    </div>
                </div>

                <div className="p-4 grid grid-cols-2 gap-3 bg-slate-50/50 border-b border-slate-100">
                    <Button onClick={() => navigate('/publish')} className="h-12 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest italic shadow-lg gap-2 border-none active:scale-95 transition-all">
                        <Plus size={14} className="text-primary" /> {t('nav.publish')}
                    </Button>
                    <Button onClick={() => navigate('/request')} className="h-12 rounded-2xl bg-white text-slate-900 font-black text-[10px] uppercase tracking-widest italic shadow-md gap-2 border border-slate-200 active:scale-95 transition-all">
                        <Megaphone size={14} className="text-secondary" /> {t('nav.request')}
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                    <ActivitySummaryPanel copy={copy} summary={activitySummary} loading={isActivityLoading} onRefresh={fetchActivitySummary} navigate={navigate} />
                    <SearchPanel {...searchPanelProps} />

                    <div className="sticky top-0 bg-white z-20 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar border-b border-slate-50">
                        {filters.map((f) => (
                            <button key={f.id} onClick={() => setActiveFilter(f.id)} className={cn('px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border whitespace-nowrap', activeFilter === f.id ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-100')}>{f.label}</button>
                        ))}
                    </div>

                    <div className="space-y-3">
                        {loading ? (
                            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary/40 h-8 w-8" /></div>
                        ) : itemsToDisplay.length > 0 ? (
                            itemsToDisplay.map((item) => (
                                <RideCard key={`${item.type}-${item.id}`} item={item} isSelected={selectedItem?.id === item.id} onClick={(i, force) => handleSelection(i, force)} copy={copy} language={language} />
                            ))
                        ) : (
                            <div className="text-center py-12 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-100 px-5">
                                <Car className="mx-auto h-10 w-10 text-slate-200 mb-3 opacity-50" />
                                <p className="text-sm font-black text-slate-900 uppercase italic">{activeSearch ? copy.noSearchResults : t('dashboard.no_results')}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{activeSearch ? copy.noSearchResultsDesc : copy.noNearbyResults}</p>
                                {activeSearch && (
                                    <Button onClick={navigateToRequestWithSearch} className="mt-5 h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-widest text-[10px] gap-2">
                                        <Megaphone size={15} /> {copy.createRequest}
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 relative h-full">
                <MapComponent
                    center={{ lat: mapCenter[0], lng: mapCenter[1] }}
                    zoom={zoom}
                    itemsToDisplay={itemsToDisplay}
                    selectedItemId={selectedItem?.id}
                    onItemSelected={(item) => handleSelection(item, true)}
                />

                <div className="lg:hidden absolute top-16 left-3 right-3 z-[1100] flex flex-col gap-2 pointer-events-none [transform:translateZ(0)]">
                    <div className="pointer-events-auto">
                        <SearchPanel {...searchPanelProps} compact />
                    </div>
                    <div className="flex items-center gap-2 pointer-events-auto">
                        <div className="flex flex-1 gap-2 overflow-x-auto no-scrollbar">
                            {filters.map((f) => (
                                <button key={f.id} onClick={() => setActiveFilter(f.id)} className={cn('px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all shadow-lg backdrop-blur-md border', activeFilter === f.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/90 text-slate-600 border-white/50')}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <Button
                            onClick={handleLocateMe}
                            className="h-10 w-10 shrink-0 rounded-2xl bg-white/95 text-slate-900 shadow-lg border border-white/50"
                            size="icon"
                            aria-label={copy.nearMe}
                        >
                            <Navigation className="h-4 w-4 text-primary" />
                        </Button>
                    </div>
                </div>

                <Button
                    onClick={handleLocateMe}
                    className="hidden lg:flex absolute bottom-8 left-4 z-[1100] h-14 px-4 rounded-2xl bg-white/95 backdrop-blur-xl text-slate-900 shadow-2xl border border-white/50 items-center gap-2 hover:bg-white transition-all active:scale-90 group"
                >
                    <Navigation className="h-5 w-5 text-primary rotate-45 group-hover:rotate-0 transition-transform duration-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest pr-1">{copy.nearMe}</span>
                </Button>

                {isMobile && (
                    <div
                        className="fixed inset-x-3 z-[1100] flex gap-2 lg:hidden [transform:translateZ(0)]"
                        style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom, 0px))' }}
                    >
                        <Button
                            onClick={() => navigate('/publish')}
                            className="flex-1 h-14 rounded-2xl bg-slate-900 text-white shadow-2xl border-none active:scale-95 font-black uppercase italic tracking-widest text-[11px] gap-2"
                        >
                            <Plus size={16} className="text-primary" /> {t('create_ride.title')}
                        </Button>
                        <Button
                            onClick={() => navigateToRequestWithSearch()}
                            className="flex-1 h-14 rounded-2xl bg-white text-slate-900 shadow-2xl border border-slate-200 active:scale-95 font-black uppercase italic tracking-widest text-[11px] gap-2"
                        >
                            <Megaphone size={16} className="text-amber-500" /> {t('create_request.title')}
                        </Button>
                    </div>
                )}

                {isMobile && (
                    <div className="lg:hidden">
                        <DraggableSheet activeSnap={selectedItem ? 1 : undefined}>
                            <div className="px-6 py-4 space-y-4 text-left">
                                {!selectedItem ? (
                                    <>
                                        <ActivitySummaryPanel copy={copy} summary={activitySummary} loading={isActivityLoading} onRefresh={fetchActivitySummary} navigate={navigate} />
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h3 className="text-base font-black text-slate-900 uppercase italic tracking-widest">{activeSearch ? copy.activeSearch : copy.nearYouTitle}</h3>
                                                {activeSearch && <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{itemsToDisplay.length} {copy.matchingResults}</p>}
                                            </div>
                                            <div className="size-8 bg-slate-100 rounded-full flex items-center justify-center"><Activity size={14} className="text-slate-400" /></div>
                                        </div>

                                        <div className="space-y-3 pb-20">
                                            {loading ? (
                                                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary/40 h-8 w-8" /></div>
                                            ) : itemsToDisplay.length > 0 ? (
                                                itemsToDisplay.map((item) => (
                                                    <RideCard key={`mobile-${item.type}-${item.id}`} item={item} isSelected={selectedItem?.id === item.id} onClick={(i, force) => handleSelection(i, force)} copy={copy} language={language} />
                                                ))
                                            ) : (
                                                <div className="text-center py-10 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-100 px-5">
                                                    <Car className="mx-auto h-10 w-10 text-slate-200 mb-3" />
                                                    <p className="text-[10px] font-black text-slate-900 uppercase italic">{activeSearch ? copy.noSearchResults : copy.noNearbyResults}</p>
                                                    {activeSearch && (
                                                        <Button onClick={navigateToRequestWithSearch} className="mt-5 h-12 rounded-2xl bg-amber-500 text-white font-black uppercase tracking-widest text-[10px] gap-2">
                                                            <Megaphone size={15} /> {copy.createRequest}
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="pb-10 space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-4 min-w-0">
                                                <Avatar className="h-16 w-16 border-4 border-white shadow-2xl shrink-0">
                                                    <AvatarImage src={selectedItem.type === 'request' ? selectedItem.requester?.photo_url : selectedItem.driver?.photo_url} className="object-cover" />
                                                    <AvatarFallback className="bg-slate-900 text-white font-black text-xl">{selectedItem.type === 'request' ? selectedItem.requester?.display_name?.[0] : selectedItem.driver?.display_name?.[0]}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <h3 className="truncate text-xl font-black text-slate-900 uppercase italic tracking-tighter leading-none">
                                                        {selectedItem.type === 'request' ? selectedItem.requester?.display_name : selectedItem.driver?.display_name}
                                                    </h3>
                                                    <span className={cn('text-[8px] font-black uppercase px-2 py-0.5 rounded-full border shadow-sm mt-2 inline-flex', selectedItem.type === 'request' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100')}>
                                                        {selectedItem.type === 'request' ? copy.passenger : copy.driver}
                                                    </span>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" className="rounded-full bg-slate-50 hover:bg-slate-100 h-10 w-10" onClick={() => setSelectedItem(null)}>
                                                <X size={20} className="text-slate-400" />
                                            </Button>
                                        </div>

                                        <div className="space-y-4 p-5 bg-slate-50 rounded-3xl border border-slate-100 shadow-inner">
                                            <div className="flex items-center gap-4">
                                                <MapPin className="size-5 text-primary shrink-0" />
                                                <div className="flex-1 space-y-1 min-w-0">
                                                    <p className="truncate text-xs font-bold text-slate-400 uppercase tracking-widest">{getLocationLabel(selectedItem.origin, copy.origin)}</p>
                                                    <p className="truncate text-base font-black text-slate-900 uppercase italic tracking-tight">{getLocationLabel(selectedItem.destination, copy.destination)}</p>
                                                </div>
                                            </div>
                                            <div className="h-px bg-slate-100 w-full" />
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-6">
                                                    <div className="flex items-center gap-2 text-slate-500"><Clock size={16} /><span className="text-xs font-black text-slate-900">{formatTime(new Date(selectedItem.departure_time), language)}</span></div>
                                                    <div className="flex items-center gap-2 text-slate-500"><Calendar size={16} /><span className="text-xs font-bold text-slate-400">{formatShortDate(new Date(selectedItem.departure_time), language)}</span></div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-3xl font-black text-primary tracking-tighter leading-none">{selectedItem.price || selectedItem.suggested_price || 0}€</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{copy.seatPrice}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <Button onClick={() => handleSelection(selectedItem, true)} className="w-full h-16 rounded-2xl bg-slate-900 text-white font-black text-sm uppercase italic tracking-widest shadow-2xl active:scale-95 transition-all">
                                            {selectedItem.type === 'request' ? copy.viewRequest : copy.viewDetails} <ChevronRight size={20} className="ml-2 text-primary" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </DraggableSheet>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Dashboard;
