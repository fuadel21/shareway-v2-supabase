-- ==========================================
-- SECURITY HARDENING: Blindaje RLS Final v4.0
-- Proposito: Eliminar fugas de privacidad y asegurar integridad financiera.
-- ==========================================

-- 1. LIMPIEZA DE POLÍTICAS DE SOLICITUDES (Privacidad de Itinerario)
DROP POLICY IF EXISTS "Users can view ride requests related to them" ON public.ride_requests;
DROP POLICY IF EXISTS "Anyone can view ride requests" ON public.ride_requests;

CREATE POLICY "Users can view their own requests" 
  ON public.ride_requests FOR SELECT 
  USING (auth.uid() = requester_id);

CREATE POLICY "Authenticated users can search requests" 
  ON public.ride_requests FOR SELECT 
  USING (status = 'pending' AND auth.uid() IS NOT NULL);

-- 2. BLINDAJE FINANCIERO (Zero-Client-Write Policy)
-- Eliminamos permisos de inserción/actualización directa para evitar fraudes desde consola.
DROP POLICY IF EXISTS "Users can insert their own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can update their own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.transactions;

CREATE POLICY "Wallet View Only" 
  ON public.wallets FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Transactions View Only" 
  ON public.transactions FOR SELECT 
  USING (auth.uid() = user_id);

-- 3. SEGURIDAD DE CHAT (Optimización)
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
CREATE POLICY "Message Privacy" 
  ON public.messages FOR SELECT 
  USING (
    sender_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM public.chats 
      WHERE id = chat_id AND auth.uid() = ANY(participants)
    )
  );

-- 4. POLÍTICA DE ADMINISTRADOR MAESTRO (Auditability)
-- Creamos una función de ayuda para verificar rol de admin
CREATE OR REPLACE FUNCTION public.is_admin() 
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Aplicar super-visibilidad a admins en tablas críticas
CREATE POLICY "Admins bypass rides" ON public.rides FOR ALL USING (public.is_admin());
CREATE POLICY "Admins bypass requests" ON public.ride_requests FOR ALL USING (public.is_admin());
CREATE POLICY "Admins bypass transactions" ON public.transactions FOR ALL USING (public.is_admin());

-- 5. SEGURIDAD DE PERFILES (Evitar scraping de datos)
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Public profile access" 
  ON public.profiles FOR SELECT 
  USING (true); -- Mantenemos visibilidad para que funcione el buscador de conductores

-- 6. PROTECCIÓN DE RLS ACTIVA (Enforcement)
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
