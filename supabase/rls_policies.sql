-- ==========================================
-- POLÍTICAS RLS PARA SHAREWAY
-- ==========================================

-- POLÍTICAS PARA PROFILES
CREATE POLICY "Users can view all profiles" 
  ON public.profiles FOR SELECT 
  USING (true);

CREATE POLICY "Users can insert their own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

-- POLÍTICAS PARA WALLETS
CREATE POLICY "Users can view their own wallet" 
  ON public.wallets FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own wallet" 
  ON public.wallets FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own wallet" 
  ON public.wallets FOR UPDATE 
  USING (auth.uid() = user_id);

-- POLÍTICAS PARA TRANSACTIONS
CREATE POLICY "Users can view their own transactions" 
  ON public.transactions FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions" 
  ON public.transactions FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- POLÍTICAS PARA RIDES
CREATE POLICY "Anyone can view rides" 
  ON public.rides FOR SELECT 
  USING (true);

CREATE POLICY "Users can create rides" 
  ON public.rides FOR INSERT 
  WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Drivers can update their own rides" 
  ON public.rides FOR UPDATE 
  USING (auth.uid() = driver_id);

CREATE POLICY "Drivers can delete their own rides" 
  ON public.rides FOR DELETE 
  USING (auth.uid() = driver_id);

-- POLÍTICAS PARA RIDE_REQUESTS
CREATE POLICY "Users can view ride requests related to them" 
  ON public.ride_requests FOR SELECT 
  USING (
    auth.uid() = requester_id OR 
    auth.uid() IN (SELECT driver_id FROM public.rides WHERE id = ride_id)
  );

CREATE POLICY "Users can create ride requests" 
  ON public.ride_requests FOR INSERT 
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Users can update their own ride requests" 
  ON public.ride_requests FOR UPDATE 
  USING (auth.uid() = requester_id);

CREATE POLICY "Users can delete their own ride requests" 
  ON public.ride_requests FOR DELETE 
  USING (auth.uid() = requester_id);

-- POLÍTICAS PARA FAVORITE_ROUTES
CREATE POLICY "Users can view their own favorite routes" 
  ON public.favorite_routes FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own favorite routes" 
  ON public.favorite_routes FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own favorite routes" 
  ON public.favorite_routes FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favorite routes" 
  ON public.favorite_routes FOR DELETE 
  USING (auth.uid() = user_id);

-- POLÍTICAS PARA EMERGENCY_CONTACTS
CREATE POLICY "Users can view their own emergency contacts" 
  ON public.emergency_contacts FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own emergency contacts" 
  ON public.emergency_contacts FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own emergency contacts" 
  ON public.emergency_contacts FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own emergency contacts" 
  ON public.emergency_contacts FOR DELETE 
  USING (auth.uid() = user_id);

-- POLÍTICAS PARA CHATS
CREATE POLICY "Users can view chats they participate in" 
  ON public.chats FOR SELECT 
  USING (auth.uid() = ANY(participants));

CREATE POLICY "Users can create chats" 
  ON public.chats FOR INSERT 
  WITH CHECK (auth.uid() = ANY(participants));

CREATE POLICY "Users can update chats they participate in" 
  ON public.chats FOR UPDATE 
  USING (auth.uid() = ANY(participants));

-- POLÍTICAS PARA MESSAGES
CREATE POLICY "Users can view messages in their chats" 
  ON public.messages FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.chats 
      WHERE id = chat_id AND auth.uid() = ANY(participants)
    )
  );

CREATE POLICY "Users can create messages in their chats" 
  ON public.messages FOR INSERT 
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.chats 
      WHERE id = chat_id AND auth.uid() = ANY(participants)
    )
  );

-- POLÍTICAS PARA REVIEWS
CREATE POLICY "Anyone can view reviews" 
  ON public.reviews FOR SELECT 
  USING (true);

CREATE POLICY "Users can create reviews" 
  ON public.reviews FOR INSERT 
  WITH CHECK (auth.uid() = author_id);

-- POLÍTICAS PARA COMMUNITIES
CREATE POLICY "Anyone can view communities" 
  ON public.communities FOR SELECT 
  USING (true);

CREATE POLICY "Admins can manage communities" 
  ON public.communities FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role = 'admin' OR is_admin = true)
    )
  );

-- POLÍTICAS PARA NOTIFICACIONES
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own notifications" 
  ON public.notifications FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications" 
  ON public.notifications FOR UPDATE 
  USING (auth.uid() = user_id);

-- POLÍTICAS PARA LOGROS (GAMIFICACIÓN)
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view achievements" 
  ON public.achievements FOR SELECT 
  USING (true);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own achievements" 
  ON public.user_achievements FOR SELECT 
  USING (auth.uid() = user_id);

-- POLÍTICAS PARA PAYOUT_REQUESTS
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own payout requests"
  ON public.payout_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own payout requests"
  ON public.payout_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all payout requests"
  ON public.payout_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can update payout requests"
  ON public.payout_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- POLÍTICAS PARA CANCELLATION_DISPUTES
ALTER TABLE public.cancellation_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own disputes"
  ON public.cancellation_disputes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own disputes"
  ON public.cancellation_disputes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all disputes"
  ON public.cancellation_disputes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can update disputes"
  ON public.cancellation_disputes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
