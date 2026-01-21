import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home, Users, ShieldCheck, LogOut, Building2 } from 'lucide-react'; // <-- Building2 importado
import { cn } from '@/lib/utils';

const NavItem = ({ to, icon: Icon, children }) => {
    const location = useLocation();
    const isActive = location.pathname.startsWith(to);
    return (
        <Link to={to}>
            <Button variant={isActive ? 'secondary' : 'ghost'} className="w-full justify-start">
                <Icon className="mr-2 h-4 w-4" />
                {children}
            </Button>
        </Link>
    );
};

const AdminLayout = ({ handleSignOut, profile }) => {
    return (
        <div className="min-h-screen w-full flex">
            <aside className="w-64 flex-shrink-0 bg-gray-100 border-r p-4 flex flex-col">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900">Admin Panel</h2>
                    <p className="text-sm text-gray-600">Taxi Compartido</p>
                </div>
                <nav className="flex-grow space-y-2">
                    <NavItem to="/admin/dashboard" icon={Home}>Dashboard</NavItem>
                    <NavItem to="/admin/verifications" icon={ShieldCheck}>Verificaciones</NavItem>
                    <NavItem to="/admin/users" icon={Users}>Usuarios</NavItem>
                    <NavItem to="/admin/communities" icon={Building2}>Comunidades</NavItem> {/* <-- Enlace añadido */}
                </nav>
                <div className="mt-auto">
                    <div className="mb-4 p-2 bg-gray-200 rounded-lg text-center">
                        <p className="text-sm font-semibold">{profile?.name || 'Admin'}</p>
                        <p className="text-xs text-gray-600">{profile?.email}</p>
                    </div>
                    <Button variant="destructive" className="w-full" onClick={handleSignOut}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Cerrar Sesión
                    </Button>
                </div>
            </aside>
            <main className="flex-1 p-8 bg-white overflow-auto">
                <Outlet />
            </main>
        </div>
    );
};

export default AdminLayout;
