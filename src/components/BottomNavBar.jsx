import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Car, MessageSquare, User, Compass } from 'lucide-react';
import { cn } from '@/lib/utils';

const BottomNavBar = ({ totalUnreadChats, activeRideForUser }) => {

    const navItems = [
        { to: '/dashboard', icon: Home, label: 'Inicio' },
        { to: '/my-rides', icon: Compass, label: 'Mis Viajes', isRideActive: !!activeRideForUser },
        { to: '/chats', icon: MessageSquare, label: 'Mensajes', badge: totalUnreadChats },
        { to: '/account', icon: User, label: 'Cuenta' },
    ];

    return (
        <footer className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white border-t z-20">
            <nav className="flex justify-around items-center h-16">
                {navItems.map(item => (
                    <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(
                        "flex flex-col items-center justify-center text-xs gap-1 relative w-full h-full transition-colors",
                        isActive ? 'text-white font-bold' : 'text-gray-400 hover:text-white',
                        item.isRideActive && !isActive && 'text-blue-400 animate-pulse' 
                    )}>
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
