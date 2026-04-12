import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Car, MessageSquare, User, Compass } from 'lucide-react';
import { cn } from '@/lib/utils';

const BottomNavBar = ({ totalUnreadChats, activeRideForUser }) => {
    const { t } = useTranslation();

    const navItems = [
        { to: '/dashboard', icon: Home, label: t('nav.explore') },
        { to: '/my-rides', icon: Compass, label: t('nav.my_rides') },
        { to: '/chats', icon: MessageSquare, label: t('nav.chat'), badge: totalUnreadChats },
        { to: '/account', icon: User, label: t('nav.settings') },
    ];

    return (
        <footer
            className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white border-t z-20"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            <nav className="flex justify-around items-center h-16">
                {navItems.map(item => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        style={{ touchAction: 'manipulation' }}
                        className={({ isActive }) => cn(
                            // Área táctil mínima 44px (Apple HIG / Material)
                            "flex flex-col items-center justify-center text-xs gap-1 relative w-full min-h-[44px] h-full transition-colors",
                            isActive ? 'text-white font-bold' : 'text-gray-400 hover:text-white',
                            item.isRideActive && !isActive && 'text-blue-400 animate-pulse'
                        )}
                    >
                        {item.badge > 0 && (
                            <span className="absolute top-2 right-1/4 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full">{item.badge}</span>
                        )}
                        <item.icon className="h-6 w-6" />
                        <span>{item.label}</span>
                    </NavLink>
                ))}
            </nav>
        </footer>
    );
};

export default BottomNavBar;
