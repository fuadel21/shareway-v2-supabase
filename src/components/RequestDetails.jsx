import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { fulfillRequest } from '@/services/rideService';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar.jsx';
import MapComponent from './MapComponent';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SubPageHeader from './SubPageHeader';
import {
    Calendar, Users, Loader2, MessageCircle, Phone,
    MapPin, Share2, Star, BadgeCheck, Euro,
    CheckCircle, ShieldCheck, ChevronRight
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        user: 'Usuario',
        loadError: 'No se pudo cargar la solicitud',
        alreadyAccepted: 'Esta solicitud ya ha sido aceptada por otro conductor.',
        noPhone: 'El pasajero no ha facilitado su teléfono',
        invalidPrice: 'Precio no válido',
        minSeats: 'Debes ofrecer al menos {{seats}} plazas.',
        creatingRide: 'Creando viaje y aceptando pasajero...',
        accepted: '¡Solicitud aceptada!',
        pageTitle: 'Detalle de Solicitud',
        activeRequest: 'Solicitud activa',
        budget: 'Presupuesto',
        call: 'Llamar',
        passengerElite: 'Pasajero Élite',
        viewProfile: 'Ver Perfil',
        requestedSeats: 'Plazas Pedidas',
        person: 'persona',
        people: 'personas',
        insurance: 'Seguro',
        included: 'Incluido',
        pickup: 'Recogida',
        destination: 'Destino',
        acceptAndCreate: 'Aceptar y crear viaje',
        ownRequest: 'Esta es tu propia solicitud',
        acceptPassenger: '¿Aceptar pasajero?',
        acceptDescription: 'Confirmarás tu compromiso de recoger a {{name}}.',
        finalPrice: 'Precio final acordado (€)',
        totalCapacity: 'Tu Capacidad Total (Asientos)',
        includingSeats: 'Incluyendo las {{seats}} plazas del pasajero',
        confirmJoin: 'Confirmar incorporación',
        locale: 'es-ES'
    },
    en: {
        user: 'User',
        loadError: 'Could not load the request',
        alreadyAccepted: 'This request has already been accepted by another driver.',
        noPhone: 'The passenger has not provided a phone number',
        invalidPrice: 'Invalid price',
        minSeats: 'You must offer at least {{seats}} seats.',
        creatingRide: 'Creating ride and accepting passenger...',
        accepted: 'Request accepted!',
        pageTitle: 'Request Details',
        activeRequest: 'Active request',
        budget: 'Budget',
        call: 'Call',
        passengerElite: 'Elite Passenger',
        viewProfile: 'View Profile',
        requestedSeats: 'Requested Seats',
        person: 'person',
        people: 'people',
        insurance: 'Insurance',
        included: 'Included',
        pickup: 'Pickup',
        destination: 'Destination',
        acceptAndCreate: 'Accept and create ride',
        ownRequest: 'This is your own request',
        acceptPassenger: 'Accept passenger?',
        acceptDescription: 'You will confirm your commitment to pick up {{name}}.',
        finalPrice: 'Final agreed price (€)',
        totalCapacity: 'Your Total Capacity (Seats)',
        includingSeats: 'Including the passenger’s {{seats}} requested seats',
        confirmJoin: 'Confirm passenger',
        locale: 'en-US'
    },
    ar: {
        user: 'مستخدم',
        loadError: 'تعذر تحميل الطلب',
        alreadyAccepted: 'تم قبول هذا الطلب بالفعل من طرف سائق آخر.',
        noPhone: 'لم يضف الراكب رقم هاتفه',
        invalidPrice: 'السعر غير صالح',
        minSeats: 'يجب أن توفر على الأقل {{seats}} مقاعد.',
        creatingRide: 'جارٍ إنشاء الرحلة وقبول الراكب...',
        accepted: 'تم قبول الطلب!',
        pageTitle: 'تفاصيل الطلب',
        activeRequest: 'طلب نشط',
        budget: 'الميزانية',
        call: 'اتصال',
        passengerElite: 'راكب مميز',
        viewProfile: 'عرض الملف',
        requestedSeats: 'المقاعد المطلوبة',
        person: 'شخص',
        people: 'أشخاص',
        insurance: 'التأمين',
        included: 'مشمول',
        pickup: 'نقطة الاستلام',
        destination: 'الوجهة',
        acceptAndCreate: 'قبول وإنشاء رحلة',
        ownRequest: 'هذا هو طلبك الخاص',
        acceptPassenger: 'قبول الراكب؟',
        acceptDescription: 'ستؤكد التزامك باستلام {{name}}.',
        finalPrice: 'السعر النهائي المتفق عليه (€)',
        totalCapacity: 'السعة الإجمالية لديك (مقاعد)',
        includingSeats: 'بما في ذلك {{seats}} من مقاعد الراكب',
        confirmJoin: 'تأكيد الإضافة',
        locale: 'ar-SA'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const interpolate = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template);

const formatRequestDate = (date, copy) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    return new Intl.DateTimeFormat(copy.locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    }).format(value);
};

const formatRequestTime = (date, copy) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return '--:--';
    return new Intl.DateTimeFormat(copy.locale, {
        hour: '2-digit',
        minute: '2-digit'
    }).format(value);
};

const RequestDetails = () => {
    const { id: requestId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];

    const [request, setRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showAcceptDialog, setShowAcceptDialog] = useState(false);
    const [price, setPrice] = useState('');
    const [totalSeats, setTotalSeats] = useState('4');

    const fetchRequestDetails = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('ride_requests')
                .select('*, requester:profiles!requester_id (*)')
                .eq('id', requestId)
                .single();

            if (error) throw error;

            setRequest({
                ...data,
                dateTime: data.departure_time ? new Date(data.departure_time) : new Date(),
                requester: {
                    ...data.requester,
                    photoURL: data.requester?.photo_url,
                    displayName: data.requester?.full_name || data.requester?.display_name || copy.user,
                    rating: data.requester?.rating || 5.0,
                    phone: data.requester?.phone
                }
            });
            setPrice(String(data.suggested_price || ''));
        } catch (error) {
            toast.error(copy.loadError);
            navigate('/dashboard');
        } finally {
            setLoading(false);
        }
    }, [requestId, navigate, copy.loadError, copy.user]);

    useEffect(() => {
        if (!requestId) return;
        fetchRequestDetails();

        const channel = supabase
            .channel(`request_updates_${requestId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'ride_requests',
                filter: `id=eq.${requestId}`
            }, (payload) => {
                if (payload.new.status === 'fulfilled') {
                    toast.info(copy.alreadyAccepted);
                    navigate('/dashboard');
                } else {
                    fetchRequestDetails();
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [requestId, fetchRequestDetails, navigate, copy.alreadyAccepted]);

    const handleCallRequester = () => {
        if (request?.requester?.phone) {
            window.location.href = `tel:${request.requester.phone}`;
        } else {
            toast.error(copy.noPhone);
        }
    };

    const handleConfirmAcceptance = async () => {
        const numericPrice = Number(price.replace(',', '.'));
        if (isNaN(numericPrice) || numericPrice <= 0) return toast.error(copy.invalidPrice);

        const numericSeats = parseInt(totalSeats);
        const requestedSeats = request.requested_seats || 1;
        if (isNaN(numericSeats) || numericSeats < requestedSeats) {
            return toast.error(interpolate(copy.minSeats, { seats: requestedSeats }));
        }

        setIsSubmitting(true);
        const toastId = toast.loading(copy.creatingRide);
        try {
            await fulfillRequest(request, numericPrice, numericSeats);
            toast.success(copy.accepted, { id: toastId });
            navigate('/my-rides');
        } catch (error) {
            toast.error(error.message, { id: toastId });
        } finally {
            setIsSubmitting(false);
            setShowAcceptDialog(false);
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    if (!request) return null;

    const isMyRequest = user?.id === request.requester_id;
    const requestedSeats = request.requested_seats || 1;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-32">
            <SubPageHeader title={copy.pageTitle} backPath="/dashboard" />

            <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                <div className="h-64 w-full rounded-[2.5rem] overflow-hidden shadow-xl relative border-4 border-white">
                    <MapComponent center={request.origin} itemsToDisplay={[request]} zoom={13} />
                    <div className="absolute top-4 left-4 bg-indigo-500 text-white px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg">
                        {copy.activeRequest}
                    </div>
                </div>

                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-6 space-y-6">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1 text-left">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-[10px]">
                                <Calendar size={12} /> {formatRequestDate(request.dateTime, copy)}
                            </div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                {formatRequestTime(request.dateTime, copy)}
                            </h2>
                        </div>
                        <div className="text-right">
                            <p className="text-4xl font-black text-primary italic tracking-tighter leading-none">{request.suggested_price}€</p>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{copy.budget}</p>
                        </div>
                    </div>

                    {!isMyRequest && (
                        <div className="flex gap-2">
                            <Button onClick={handleCallRequester} className="flex-1 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border-none hover:bg-emerald-100 font-black text-[10px] uppercase tracking-widest">
                                <Phone size={16} className="mr-2" /> {copy.call}
                            </Button>
                            <Button onClick={() => navigate(`/ride-chat/${request.id}`)} className="flex-1 h-12 rounded-2xl bg-orange-50 text-orange-600 border-none hover:bg-orange-100 font-black text-[10px] uppercase tracking-widest">
                                <MessageCircle size={16} className="mr-2" /> Chat
                            </Button>
                            <Button className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 p-0 border-none">
                                <Share2 size={18} />
                            </Button>
                        </div>
                    )}

                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-[2rem]">
                        <div className="flex items-center gap-3">
                            <Avatar className="size-14 rounded-2xl border-2 border-white shadow-md">
                                <AvatarImage src={request.requester.photoURL} />
                                <AvatarFallback className="font-black bg-indigo-100 text-indigo-600">{request.requester.displayName?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="text-left">
                                <h4 className="font-black text-slate-900 uppercase italic tracking-tighter leading-none flex items-center gap-1.5">
                                    {request.requester.displayName} <BadgeCheck size={14} className="text-blue-500" />
                                </h4>
                                <div className="flex items-center gap-1 mt-1">
                                    <Star size={10} className="text-amber-400 fill-amber-400" />
                                    <span className="text-[10px] font-bold text-slate-500">{request.requester.rating} · {copy.passengerElite}</span>
                                </div>
                            </div>
                        </div>
                        <Link to={`/profile/${request.requester_id}`} className="text-primary text-[10px] font-black uppercase tracking-widest">{copy.viewProfile}</Link>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                    <Users size={12} /> {copy.requestedSeats}
                                </p>
                                <p className="text-sm font-bold text-slate-700">
                                    {requestedSeats} {requestedSeats === 1 ? copy.person : copy.people}
                                </p>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                    <ShieldCheck size={12} /> {copy.insurance}
                                </p>
                                <p className="text-sm font-bold text-slate-700">{copy.included}</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="flex flex-col items-center pt-1">
                                <div className="size-3 rounded-full border-2 border-primary bg-white" />
                                <div className="w-0.5 h-10 bg-slate-100 my-1" />
                                <MapPin size={14} className="text-emerald-500" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="text-[8px] font-black text-slate-400 uppercase">{copy.pickup}</p>
                                <p className="text-sm font-bold text-slate-900 leading-tight">{request.origin?.address}</p>
                                <p className="text-[8px] font-black text-slate-400 uppercase mt-3">{copy.destination}</p>
                                <p className="text-sm font-bold text-slate-900 leading-tight">{request.destination?.address}</p>
                            </div>
                        </div>
                    </div>

                    {!isMyRequest && request.status === 'pending' && (
                        <Button
                            onClick={() => setShowAcceptDialog(true)}
                            className="w-full h-20 rounded-[2rem] bg-slate-900 text-white font-black text-xl italic shadow-2xl uppercase active:scale-95 transition-all border-none"
                        >
                            {copy.acceptAndCreate}
                        </Button>
                    )}

                    {isMyRequest && (
                        <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-center">
                            <p className="text-[10px] font-black text-indigo-600 uppercase italic">{copy.ownRequest}</p>
                        </div>
                    )}
                </Card>
            </div>

            <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
                <DialogContent className="max-w-[90vw] sm:max-w-[400px] rounded-[2.5rem] border-none p-8 space-y-6 outline-none">
                    <div className="text-center space-y-2">
                        <div className="size-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <CheckCircle size={32} />
                        </div>
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter">{copy.acceptPassenger}</DialogTitle>
                        <DialogDescription className="text-xs font-bold text-slate-400">
                            {interpolate(copy.acceptDescription, { name: request.requester.displayName })}
                        </DialogDescription>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest ml-4">{copy.finalPrice}</Label>
                        <div className="relative">
                            <Euro className="absolute left-6 top-1/2 -translate-y-1/2 text-primary" size={20} />
                            <Input
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                className="h-16 pl-14 text-2xl font-black rounded-2xl bg-slate-50 border-none text-center shadow-inner"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest ml-4">{copy.totalCapacity}</Label>
                        <div className="relative">
                            <Users className="absolute left-6 top-1/2 -translate-y-1/2 text-primary" size={20} />
                            <Input
                                type="number"
                                min={requestedSeats}
                                max="8"
                                value={totalSeats}
                                onChange={(e) => setTotalSeats(e.target.value)}
                                className="h-16 pl-14 text-2xl font-black rounded-2xl bg-slate-50 border-none text-center shadow-inner"
                            />
                        </div>
                        <p className="text-[9px] text-center text-slate-400 font-bold uppercase tracking-tight">
                            {interpolate(copy.includingSeats, { seats: requestedSeats })}
                        </p>
                    </div>

                    <Button
                        onClick={handleConfirmAcceptance}
                        disabled={isSubmitting}
                        className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs shadow-xl flex gap-2"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin" /> : <>{copy.confirmJoin} <ChevronRight size={18} /></>}
                    </Button>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default RequestDetails;
