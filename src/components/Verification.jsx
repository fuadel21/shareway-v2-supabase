import React, { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import SubPageHeader from './SubPageHeader';
import { Button } from '@/components/ui/button.jsx';
import { ChevronDown, ShieldCheck, ShieldAlert, Shield, KeyRound, HeartHandshake } from 'lucide-react';
import { cn } from '@/lib/utils';

// Componente para una sección del acordeón
const SecurityAccordionItem = ({ icon: Icon, title, description, isOpen, onClick, children }) => (
    <div className="border-b last:border-0">
        <button onClick={onClick} className="w-full text-left p-6 hover:bg-slate-50 transition-all flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${isOpen ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon className="h-6 w-6" />
                </div>
                <div>
                    <p className="font-bold text-lg text-slate-800">{title}</p>
                    <p className="text-sm text-slate-500">{description}</p>
                </div>
            </div>
            <ChevronDown className={cn("transition-transform duration-300", isOpen && "rotate-180")} />
        </button>
        {isOpen && <div className="p-6 bg-slate-50/50">{children}</div>}
    </div>
);

// Componente principal del Centro de Confianza y Seguridad
const Verification = () => {
    const { profile } = useOutletContext();
    const navigate = useNavigate();
    const [openItem, setOpenItem] = useState(null);

    const verificationStatus = profile?.verification?.status || 'unverified';

    const statusConfig = {
        verified: {
            icon: ShieldCheck,
            color: 'text-green-500',
            bgColor: 'bg-green-50',
            title: 'Cuenta Verificada',
            description: '¡Excelente! Tu identidad ha sido confirmada.',
            buttonText: 'Ver Detalles',
            buttonAction: () => navigate('/settings/verification')
        },
        pending: {
            icon: ShieldAlert,
            color: 'text-yellow-500',
            bgColor: 'bg-yellow-50',
            title: 'Verificación Pendiente',
            description: 'Tu solicitud está siendo revisada por nuestro equipo.',
            buttonText: 'Revisar Estado',
            buttonAction: () => navigate('/settings/verification')
        },
        unverified: {
            icon: Shield,
            color: 'text-blue-500',
            bgColor: 'bg-blue-50',
            title: 'Verifica Tu Identidad',
            description: 'Aumenta la confianza y seguridad en la comunidad.',
            buttonText: 'Empezar Verificación',
            buttonAction: () => navigate('/settings/verification')
        }
    };

    const currentStatus = statusConfig[verificationStatus] || statusConfig.unverified;

    const securityItems = [
        { id: 'password', icon: KeyRound, title: 'Contraseña', description: 'Gestiona tu método de acceso.', content: <div>Contenido para gestionar contraseña...</div> },
        { id: 'emergency', icon: HeartHandshake, title: 'Contactos de Emergencia', description: 'Añade contactos para casos de emergencia.', content: <div>Contenido para contactos de emergencia...</div> },
    ];

    return (
        <div className="bg-slate-50 min-h-screen pb-20">
            <SubPageHeader title="Confianza y Seguridad" />
            
            <main className="max-w-xl mx-auto px-4 -mt-12 relative z-10 space-y-8">
                {/* Tarjeta de Estado de Verificación */}
                <div className={`rounded-2xl p-6 flex items-center gap-6 ${currentStatus.bgColor}`}>
                    <currentStatus.icon className={`h-10 w-10 ${currentStatus.color}`} />
                    <div className="flex-grow">
                        <h2 className={`font-bold text-xl ${currentStatus.color}`}>{currentStatus.title}</h2>
                        <p className="text-slate-600">{currentStatus.description}</p>
                    </div>
                    <Button onClick={currentStatus.buttonAction} className="rounded-full whitespace-nowrap">{currentStatus.buttonText}</Button>
                </div>

                {/* Acordeón de Herramientas de Seguridad */}
                <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                    {securityItems.map(item => (
                        <SecurityAccordionItem
                            key={item.id}
                            icon={item.icon}
                            title={item.title}
                            description={item.description}
                            isOpen={openItem === item.id}
                            onClick={() => setOpenItem(openItem === item.id ? null : item.id)}
                        >
                            {item.content}
                        </SecurityAccordionItem>
                    ))}
                </div>
            </main>
        </div>
    );
};

export default Verification;
