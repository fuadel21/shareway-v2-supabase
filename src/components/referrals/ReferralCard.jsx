import React from 'react';
import { Copy, Gift, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { getReferralCode, getReferralMessage, getReferralUrl } from '@/lib/referrals.js';
import { trackGrowthEvent } from '@/lib/growthAnalytics.js';

const ReferralCard = ({ profile, user }) => {
  const referralCode = getReferralCode(profile, user);
  const referralUrl = getReferralUrl(profile, user);
  const message = getReferralMessage(profile, user);

  const trackShare = (method) => trackGrowthEvent('referral_link_shared', {
    referralCode,
    metadata: { method }
  });

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      await trackShare('copy_link');
      toast.success('Invitación copiada', { description: 'Comparte tu enlace para invitar usuarios.' });
    } catch (error) {
      toast.error('No se pudo copiar el enlace');
    }
  };

  const shareInvite = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Únete a ShareWay',
          text: message,
          url: referralUrl,
        });
        await trackShare('native_share');
        return;
      }
      await navigator.clipboard.writeText(message);
      await trackShare('copy_message');
      toast.success('Mensaje copiado', { description: 'Pégalo en WhatsApp, Telegram o redes.' });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        toast.error('No se pudo compartir la invitación');
      }
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] p-5 text-white shadow-xl">
      <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl" />

      <div className="relative flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 border border-white/20">
          <Gift className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/80">Comunidad</p>
          <h3 className="mt-1 text-xl font-black tracking-tighter">Invita y haz crecer ShareWay</h3>
          <p className="mt-1.5 text-xs leading-5 text-white/75">Comparte tu enlace con amigos, compañeros de trabajo o grupos locales.</p>
        </div>
      </div>

      <div className="relative mt-5 rounded-2xl border border-white/10 bg-white/10 p-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Tu enlace</p>
        <p className="mt-1 truncate text-sm font-bold text-white/90">{referralUrl}</p>
      </div>

      <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
        <Button onClick={shareInvite} className="h-13 rounded-2xl bg-primary font-black uppercase tracking-normal text-white hover:bg-primary">
          <Share2 className="mr-2 h-4 w-4" /> Compartir
        </Button>
        <Button onClick={copyInvite} variant="outline" className="h-13 rounded-2xl border-white/10 bg-white/10 font-black uppercase tracking-normal text-white hover:bg-white/20">
          <Copy className="mr-2 h-4 w-4" /> Copiar
        </Button>
      </div>

      <div className="relative mt-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-300">
        <Send className="h-3.5 w-3.5" /> Ideal para WhatsApp, Telegram y Facebook
      </div>
    </div>
  );
};

export default ReferralCard;
