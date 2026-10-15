import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ShieldCheck, Users, Building2, Car,
  DollarSign, AlertCircle, RefreshCw, Leaf,
  Menu, X
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/admin/verifications', icon: ShieldCheck, label: 'Verif.' },
  { to: '/admin/users', icon: Users, label: 'User' },
  { to: '/admin/communities', icon: Building2, label: 'Comu' },
  { to: '/admin/rides', icon: Car, label: 'Viajes' },
  { to: '/admin/finance', icon: DollarSign, label: 'Fin.' },
  { to: '/admin/disputes', icon: AlertCircle, label: 'Disp.' },
  { to: '/admin/maintenance', icon: RefreshCw, label: 'Mant.' },
  { to: '/admin/climate', icon: Leaf, label: 'Auditor' },
];

const AdminMobileNav = () => {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[1000] bg-slate-900 border-t border-slate-800 lg:hidden shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
         style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center gap-1 h-12 px-4 overflow-x-auto no-scrollbar snap-x">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center justify-center min-w-[64px] h-full transition-all duration-300 relative snap-center",
                isActive ? "text-primary" : "text-slate-500"
              )}
            >
              <div className={cn(
                "p-2 rounded-xl transition-all duration-300",
                isActive ? "bg-primary/10 mb-1" : "mb-1"
              )}>
                <item.icon className={cn("h-5 w-5", isActive ? "stroke-[2.5px]" : "stroke-[2px]")} />
              </div>
              <span className={cn(
                "text-[8px] font-black uppercase tracking-tighter text-center leading-none",
                isActive ? "opacity-100" : "opacity-60"
              )}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute top-0 inset-x-2 h-0.5 bg-primary rounded-full shadow-[0_0_15px_#3b82f6]" />
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};

export default AdminMobileNav;
