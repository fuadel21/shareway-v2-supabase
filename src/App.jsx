import { useState, useEffect, useCallback, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { Toaster } from 'sonner';

import { supabase } from './lib/supabase.js';
import { Loader2 } from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';

// --- Error Boundary ---
import ErrorBoundary from './components/ErrorBoundary.jsx';

// --- Layouts & Pages ---
import MainLayout from './components/MainLayout.jsx';
import AdminLayout from './pages/Admin/AdminLayout.jsx';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import ForgotPassword from './components/ForgotPassword.jsx';
import Dashboard from './components/Dashboard.jsx';
import CreateRide from './components/CreateRide.jsx';
import CreateRequest from './components/CreateRequest.jsx';
import RideDetails from './components/RideDetails.jsx';
import RequestDetails from './components/RequestDetails.jsx';
import MyRides from './components/MyRides.jsx';
import MyRequests from './components/MyRequests.jsx';
import UserProfile from './components/UserProfile.jsx';
import EditProfile from './components/EditProfile.jsx';
import Settings from './components/Settings.jsx';
import Wallet from './components/Wallet.jsx';
import VerificationSettings from './components/VerificationSettings.jsx';
import SecuritySettings from './components/SecuritySettings.jsx';
import Achievements from './components/Achievements.jsx';
import ComingSoon from './components/ComingSoon.jsx';
import NotificationSettings from './components/NotificationSettings.jsx';
import AppearanceSettings from './components/AppearanceSettings.jsx';
import AdminDashboard from './pages/Admin/AdminDashboard.jsx';
import ChatList from './components/ChatList.jsx';
import Chat from './components/Chat.jsx';
import PayoutSettings from './components/PayoutSettings.jsx';
import LeaveReview from './components/LeaveReview.jsx';
import DisputeHistory from './components/DisputeHistory.jsx';
import FavoriteRoutes from './components/FavoriteRoutes.jsx';
import EmergencyContacts from './components/EmergencyContacts.jsx';
import RideChat from './components/RideChat.jsx';
import RideChatSelector from './components/RideChatSelector.jsx';
import EmergencyChat from './components/EmergencyChat.jsx';
import EditFavoriteRoute from './components/EditFavoriteRoute.jsx';
import VerificationCenter from './components/VerificationCenter.jsx';
import ClimateImpact from './components/ClimateImpact.jsx';

const FullScreenLoader = ({ text = 'Cargando Elite...' }) => (
    <div className="h-screen flex flex-col items-center justify-center bg-white gap-6 text-left animate-elite-in">
        <div className="relative">
            <div className="size-20 rounded-[2rem] border-2 border-slate-100 flex items-center justify-center shadow-elite animate-pulse-elite">
                <Loader2 className="h-8 w-8 animate-spin text-primary opacity-40" />
            </div>
            <div className="absolute -top-1 -right-1 size-4 bg-primary rounded-full border-2 border-white shadow-lg animate-bounce" />
        </div>
        <div className="space-y-1 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-900 italic">{text}</p>
            <div className="h-0.5 w-12 bg-slate-100 mx-auto rounded-full overflow-hidden">
                <div className="h-full bg-primary w-1/2 animate-[progress_2s_infinite_ease-in-out]" />
            </div>
        </div>
    </div>
);

const ProtectedLayout = ({ user, profile, isLoading, ...rest }) => {
    if (isLoading) return <FullScreenLoader text="Sincronizando Perfil..." />;
    if (!user) return <Navigate to="/login" replace />;
    if (!profile) return <FullScreenLoader text="Finalizando Configuración..." />;

    return (
        <ErrorBoundary level="page">
            <MainLayout user={user} profile={profile} {...rest} />
        </ErrorBoundary>
    );
};

const AdminLayoutWrapper = ({ user, profile, isLoading, ...rest }) => {
    if (isLoading) return <FullScreenLoader text="Verificando Nivel Admin..." />;
    if (!user || !profile || !profile.is_admin) return <Navigate to="/dashboard" replace />;

    return (
        <ErrorBoundary level="page">
            <AdminLayout user={user} profile={profile} {...rest} />
        </ErrorBoundary>
    );
};

function App() {
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);

    const refreshProfile = useCallback(() => setRefreshKey(prev => prev + 1), []);

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (!session) {
                setProfile(null);
                setIsLoading(false);
            }
        });
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const setupBackButton = async () => {
            const listener = await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
                const path = window.location.pathname;
                if (['/', '/login', '/dashboard', '/my-rides', '/chats', '/settings'].includes(path)) {
                    CapacitorApp.exitApp();
                } else {
                    window.history.back();
                }
            });
            return listener;
        };

        let listenerPromise = setupBackButton();
        return () => { listenerPromise.then(l => l.remove()).catch(() => { }); };
    }, []);

    useEffect(() => {
        let isMounted = true;
        const userId = session?.user?.id;

        if (!userId) {
            setProfile(null);
            if (!session) setIsLoading(false);
            return;
        }

        const loadProfile = async (retries = 3) => {
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    if (isMounted) {
                        setProfile(data);
                        setIsLoading(false);
                    }
                } else if (retries > 0) {
                    setTimeout(() => loadProfile(retries - 1), 1500);
                } else {
                    const { data: newProfile, error: createError } = await supabase
                        .from('profiles')
                        .insert({
                            id: userId,
                            email: session.user.email,
                            display_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Miembro'
                        })
                        .select().single();

                    if (!createError && isMounted) {
                        setProfile(newProfile);
                        setIsLoading(false);
                    }
                }
            } catch (err) {
                console.error("🛡️ App: Profile resolution failed:", err);
                if (isMounted) setIsLoading(false);
            }
        };

        setIsLoading(true);
        loadProfile();

        return () => { isMounted = false; };
    }, [session?.user?.id, refreshKey]);

    const handleSignOut = useCallback(async () => {
        setIsLoading(true);
        try {
            await supabase.auth.signOut();
            setProfile(null);
            setSession(null);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const outletContext = useMemo(() => ({
        user: session?.user,
        profile,
        isLoading,
        refreshProfile,
        handleSignOut,
        totalUnreadChats: 0
    }), [session?.user?.id, profile, isLoading, refreshProfile, handleSignOut]);

    return (
        <ErrorBoundary level="root">
            <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Toaster richColors position="top-center" closeButton />
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />

                    <Route path="/" element={<ProtectedLayout {...outletContext} />}>
                        <Route index element={profile?.is_admin ? <Navigate to="/admin" replace /> : <Navigate to="/dashboard" replace />} />
                        <Route path="dashboard" element={<Dashboard />} />
                        <Route path="my-rides" element={<MyRides />} />
                        <Route path="my-requests" element={<MyRequests />} />
                        <Route path="chats" element={<ChatList />} />
                        <Route path="chat/:chatId" element={<Chat />} />

                        <Route path="settings" element={<Settings />} />
                        <Route path="settings/vehicle" element={<ComingSoon title="Gestión de Vehículo" />} />
                        <Route path="settings/security" element={<SecuritySettings />} />
                        <Route path="settings/verification" element={<VerificationSettings />} />
                        <Route path="settings/payout" element={<PayoutSettings />} />
                        <Route path="settings/routes" element={<FavoriteRoutes />} />
                        <Route path="edit-favorite-route/:id" element={<EditFavoriteRoute />} />
                        <Route path="settings/appearance" element={<AppearanceSettings />} />
                        <Route path="settings/notifications" element={<NotificationSettings />} />
                        <Route path="settings/emergency" element={<EmergencyContacts />} />
                        <Route path="settings/impact" element={<ClimateImpact />} />
                        <Route path="verification-center" element={<VerificationCenter />} />

                        <Route path="profile/edit" element={<EditProfile />} />
                        <Route path="publish" element={<CreateRide />} />
                        <Route path="create-ride" element={<Navigate to="/publish" replace />} />
                        <Route path="request" element={<CreateRequest />} />
                        <Route path="create-request" element={<Navigate to="/request" replace />} />
                        <Route path="ride/:id" element={<RideDetails />} />
                        <Route path="rides/:rideId/chats" element={<RideChatSelector />} />
                        <Route path="rides/:rideId/chat/:chatId" element={<RideChat />} />
                        <Route path="ride-chat/:rideId" element={<RideChat />} />
                        <Route path="emergency" element={<EmergencyChat />} />
                        <Route path="request/:id" element={<RequestDetails />} />
                        <Route path="profile/:userId" element={<UserProfile />} />
                        <Route path="wallet" element={<Wallet />} />
                        <Route path="achievements" element={<Achievements />} />
                        <Route path="leave-review/:rideId/:revieweeId" element={<LeaveReview />} />
                        <Route path="disputes" element={<DisputeHistory />} />
                    </Route>

                    <Route path="/admin" element={<AdminLayoutWrapper {...outletContext} />}>
                        <Route index element={<Navigate to="/admin/verifications" replace />} />
                        <Route path=":tab" element={<AdminDashboard />} />
                    </Route>

                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Router>
        </ErrorBoundary>
    );
}

export default App;
