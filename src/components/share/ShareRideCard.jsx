import React, { useState } from 'react';
import { Check, Copy, Link2, Loader2, MessageCircle, Share2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { createRideShareToken, revokeRideShareToken } from '@/lib/supabaseRPC.js';

const getPublicShareUrl = (rideId, token) => {
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://www.shareway.es';
  return `${origin}/track/${encodeURIComponent(rideId)}?token=${encodeURIComponent(token)}`;
};

const buildShareText = (ride, rideUrl) => {
  const origin = ride?.origin_address || ride?.origin?.address || 'mi origen';
  const destination = ride?.destination_address || ride?.destination?.address || 'mi destino';
  return `Estoy realizando un viaje compartido de ${origin} a ${destination}. Puedes seguir mi ubicación en tiempo real aquí: ${rideUrl}`;
};

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard unavailable');
};

const ShareRideCard = ({ ride, rideId }) => {
  const [share, setShare] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  const createLink = async () => {
    if (!rideId || isCreating) return null;

    setIsCreating(true);
    try {
      const response = await createRideShareToken(rideId);
      const payload = response?.data;
      if (!response?.success || payload?.success === false || !payload?.token) {
        throw new Error(response?.error || payload?.error || 'No se pudo generar el enlace');
      }

      const nextShare = {
        tokenId: payload.token_id,
        url: getPublicShareUrl(rideId, payload.token),
        expiresAt: payload.expires_at,
      };
      setShare(nextShare);
      return nextShare;
    } catch (error) {
      toast.error('No se pudo generar el enlace', {
        description: error?.message || 'El servidor no autorizó compartir este viaje.',
      });
      return null;
    } finally {
      setIsCreating(false);
    }
  };

  const ensureShare = async () => share || createLink();

  const handleCopy = async () => {
    try {
      const currentShare = await ensureShare();
      if (!currentShare) return;
      await copyText(currentShare.url);
      toast.success('Enlace seguro copiado');
    } catch {
      toast.error('No se pudo copiar el enlace');
    }
  };

  const handleNativeShare = async () => {
    const currentShare = await ensureShare();
    if (!currentShare) return;

    const shareText = buildShareText(ride, currentShare.url);
    if (!navigator.share) {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      await navigator.share({
        title: 'Seguimiento seguro de mi viaje ShareWay',
        text: shareText,
        url: currentShare.url,
      });
    } catch (error) {
      if (error?.name !== 'AbortError') toast.error('No se pudo compartir el enlace');
    }
  };

  const handleRevoke = async () => {
    if (!share?.tokenId || isRevoking) return;

    setIsRevoking(true);
    try {
      const response = await revokeRideShareToken(share.tokenId);
      const payload = response?.data;
      if (!response?.success || payload?.success === false) {
        throw new Error(response?.error || payload?.error || 'No se pudo revocar el enlace');
      }
      setShare(null);
      toast.success('Enlace revocado', { description: 'Ya no se puede usar para seguir el viaje.' });
    } catch (error) {
      toast.error('No se pudo revocar el enlace', { description: error?.message });
    } finally {
      setIsRevoking(false);
    }
  };

  const expiresLabel = share?.expiresAt
    ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(share.expiresAt))
    : null;

  return (
    <Card className="rounded-3xl border-none bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] p-4 text-white shadow-xl">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">Seguimiento seguro</p>
          <h3 className="mt-1 text-xl font-black tracking-tight">Comparte el progreso de tu viaje</h3>
          <p className="mt-2 text-sm leading-6 text-white/65">
            Genera un enlace temporal. Solo quien lo reciba podrá ver la ruta y, cuando comience, la ubicación en tiempo real.
          </p>
        </div>
      </div>

      {!share ? (
        <Button
          onClick={createLink}
          disabled={isCreating}
          className="mt-5 h-12 w-full rounded-2xl bg-emerald-500 font-black uppercase tracking-widest text-white hover:bg-emerald-600"
        >
          {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
          Generar enlace seguro
        </Button>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 p-3">
            <Link2 className="h-4 w-4 shrink-0 text-emerald-300" />
            <input
              value={share.url}
              readOnly
              aria-label="Enlace de seguimiento"
              className="min-w-0 flex-1 bg-transparent text-xs font-bold text-white outline-none"
            />
            <Check className="h-4 w-4 shrink-0 text-emerald-300" />
          </div>
          {expiresLabel && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
              Expira el {expiresLabel}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Button onClick={handleNativeShare} className="h-11 rounded-2xl bg-emerald-500 font-black uppercase tracking-normal text-white hover:bg-emerald-600">
              <Share2 className="mr-2 h-4 w-4" /> Compartir
            </Button>
            <Button onClick={handleCopy} variant="outline" className="h-11 rounded-2xl border-white/10 bg-white/10 font-black uppercase tracking-normal text-white hover:bg-white/20">
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <Button onClick={handleRevoke} variant="outline" disabled={isRevoking} className="h-11 rounded-2xl border-red-300/20 bg-red-500/10 font-black uppercase tracking-normal text-red-200 hover:bg-red-500/20">
              {isRevoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
              Revocar
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold leading-4 text-white/50">
            <MessageCircle className="h-3 w-3 shrink-0" /> El enlace deja de funcionar al revocarlo, al caducar o poco después de finalizar el viaje.
          </p>
        </div>
      )}
    </Card>
  );
};

export default ShareRideCard;
