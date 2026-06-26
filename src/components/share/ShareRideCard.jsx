import React from 'react';
import { Copy, MessageCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';

const buildShareText = (ride, rideUrl) => {
  const origin = ride?.origin_address || 'origen cercano';
  const destination = ride?.destination_address || 'destino compatible';
  const price = Number.isFinite(Number(ride?.price)) ? `${Number(ride.price).toFixed(2)}€` : 'precio disponible en ShareWay';
  return `He encontrado un viaje compartido en ShareWay: ${origin} → ${destination}. Precio: ${price}. Ver ruta: ${rideUrl}`;
};

const ShareRideCard = ({ ride, rideId }) => {
  const rideUrl = `https://www.shareway.es/ride/${rideId}`;
  const shareText = buildShareText(ride, rideUrl);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(rideUrl);
      toast.success('Enlace copiado', { description: 'Ya puedes compartir este viaje.' });
    } catch (error) {
      toast.error('No se pudo copiar el enlace');
    }
  };

  const nativeShare = async () => {
    if (!navigator.share) {
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      await navigator.share({
        title: 'Viaje compartido en ShareWay',
        text: shareText,
        url: rideUrl,
      });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        toast.error('No se pudo compartir');
      }
    }
  };

  return (
    <Card className="rounded-[2.5rem] border-none bg-slate-950 p-6 text-white shadow-xl">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
          <Share2 className="h-5 w-5 text-orange-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-400">Compartir viaje</p>
          <h3 className="mt-1 text-xl font-black tracking-tight">Haz crecer esta ruta</h3>
          <p className="mt-2 text-sm leading-6 text-white/65">Comparte este viaje con amigos o grupos para llenar plazas más rápido.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Button onClick={nativeShare} className="h-12 rounded-2xl bg-orange-500 font-black uppercase tracking-widest text-white hover:bg-orange-600">
          <Share2 className="mr-2 h-4 w-4" /> Compartir
        </Button>
        <Button asChild variant="outline" className="h-12 rounded-2xl border-white/10 bg-white/10 font-black uppercase tracking-widest text-white hover:bg-white/20">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
          </a>
        </Button>
        <Button onClick={copyLink} variant="outline" className="h-12 rounded-2xl border-white/10 bg-white/10 font-black uppercase tracking-widest text-white hover:bg-white/20">
          <Copy className="mr-2 h-4 w-4" /> Copiar
        </Button>
      </div>
    </Card>
  );
};

export default ShareRideCard;
