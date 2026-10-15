import React, { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';

const pages = {
    contacto: {
        title: 'Contacto | ShareWay',
        h1: 'Contacto',
        description: 'Contacta con ShareWay para dudas sobre la plataforma, colaboración, soporte o información legal.',
        sections: [
            {
                heading: 'Cómo contactar con ShareWay',
                paragraphs: [
                    'Puedes contactar con el equipo de ShareWay para consultas sobre la plataforma, soporte, seguridad, colaboración o información corporativa.',
                    'Correo de contacto: fuadel21@gmail.com'
                ]
            },
            {
                heading: 'Soporte para usuarios',
                paragraphs: [
                    'Si ya tienes cuenta, revisa también las opciones de ayuda, seguridad, verificación y actividad dentro de la aplicación.',
                    'Para incidencias relacionadas con pagos, viajes o perfiles, incluye la mayor cantidad de información posible para poder revisar el caso.'
                ]
            }
        ]
    },
    'aviso-legal': {
        title: 'Aviso legal | ShareWay',
        h1: 'Aviso legal',
        description: 'Información legal básica de ShareWay, plataforma digital para compartir trayectos y rutas compatibles.',
        sections: [
            {
                heading: 'Titularidad y finalidad',
                paragraphs: [
                    'ShareWay es una plataforma digital orientada a conectar personas con rutas compatibles para compartir trayectos, coordinar desplazamientos y reducir costes.',
                    'La información publicada en esta web tiene carácter informativo y puede evolucionar conforme se actualice el servicio.'
                ]
            },
            {
                heading: 'Uso de la plataforma',
                paragraphs: [
                    'Los usuarios deben utilizar ShareWay de forma responsable, respetando la normativa aplicable, la seguridad vial y los derechos de otros usuarios.',
                    'ShareWay no debe utilizarse para actividades ilícitas, fraudulentas o contrarias a la buena fe.'
                ]
            },
            {
                heading: 'Contacto legal',
                paragraphs: ['Para consultas legales o comunicaciones formales, puedes escribir a fuadel21@gmail.com.']
            }
        ]
    },
    privacidad: {
        title: 'Política de privacidad | ShareWay',
        h1: 'Política de privacidad',
        description: 'Información sobre el tratamiento de datos personales en ShareWay.',
        sections: [
            {
                heading: 'Datos que pueden tratarse',
                paragraphs: [
                    'ShareWay puede tratar datos necesarios para crear una cuenta, gestionar perfiles, publicar trayectos, solicitar plazas, enviar mensajes, realizar verificaciones y operar funciones de seguridad.',
                    'Entre estos datos pueden incluirse nombre, correo electrónico, teléfono, ubicación aproximada o precisa cuando el usuario la autorice, información de trayectos, mensajes relacionados con viajes y datos necesarios para pagos.'
                ]
            },
            {
                heading: 'Finalidad del tratamiento',
                paragraphs: [
                    'Los datos se utilizan para prestar el servicio, mejorar la seguridad, facilitar la comunicación entre usuarios, gestionar pagos, prevenir abusos y mejorar la experiencia de uso.',
                    'También pueden utilizarse datos agregados o anonimizados para análisis de producto y mejora del servicio.'
                ]
            },
            {
                heading: 'Derechos de los usuarios',
                paragraphs: [
                    'Los usuarios pueden solicitar información, rectificación o eliminación de sus datos cuando proceda. Para ejercer derechos o realizar consultas, pueden escribir a fuadel21@gmail.com.',
                    'Esta página no sustituye una política legal definitiva revisada por un profesional, pero establece una base informativa pública para los usuarios.'
                ]
            }
        ]
    },
    cookies: {
        title: 'Política de cookies | ShareWay',
        h1: 'Política de cookies',
        description: 'Información sobre el uso de cookies y tecnologías similares en ShareWay.',
        sections: [
            {
                heading: 'Qué son las cookies',
                paragraphs: [
                    'Las cookies y tecnologías similares permiten recordar preferencias, mantener sesiones, mejorar la seguridad y analizar el funcionamiento de la web.',
                    'ShareWay puede utilizar cookies técnicas necesarias para el funcionamiento de la aplicación y, en el futuro, herramientas de analítica o medición si se incorporan de forma adecuada.'
                ]
            },
            {
                heading: 'Gestión de cookies',
                paragraphs: [
                    'Puedes configurar o bloquear cookies desde la configuración de tu navegador. Algunas funciones pueden dejar de estar disponibles si bloqueas cookies necesarias.',
                    'Cuando se incorporen cookies no esenciales, deberán mostrarse mecanismos adecuados de información y consentimiento.'
                ]
            }
        ]
    },
    terminos: {
        title: 'Términos y condiciones | ShareWay',
        h1: 'Términos y condiciones',
        description: 'Condiciones básicas de uso de ShareWay para compartir trayectos y rutas compatibles.',
        sections: [
            {
                heading: 'Objeto del servicio',
                paragraphs: [
                    'ShareWay permite a usuarios publicar, buscar y coordinar trayectos compartidos con personas de rutas compatibles.',
                    'La plataforma facilita la conexión entre usuarios, pero cada usuario es responsable de actuar con prudencia, cumplir la normativa y mantener una conducta segura y respetuosa.'
                ]
            },
            {
                heading: 'Conducta de los usuarios',
                paragraphs: [
                    'No está permitido utilizar ShareWay para fraude, acoso, suplantación, actividades ilegales o cualquier uso que comprometa la seguridad de otros usuarios.',
                    'Los usuarios deben proporcionar información veraz y mantener actualizados los datos necesarios para usar el servicio.'
                ]
            },
            {
                heading: 'Pagos, cancelaciones y seguridad',
                paragraphs: [
                    'Las funciones de pagos, cancelaciones, verificación y seguridad pueden estar sujetas a reglas específicas dentro de la aplicación.',
                    'ShareWay podrá adaptar estas condiciones conforme evolucione el servicio y sus funcionalidades.'
                ]
            }
        ]
    }
};

const setMeta = (name, content, property = false) => {
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    let tag = document.querySelector(selector);
    if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(property ? 'property' : 'name', name);
        document.head.appendChild(tag);
    }
    tag.setAttribute('content', content);
};

const updateCanonical = (url) => {
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);
};

const LegalPage = () => {
    const location = useLocation();
    const slug = location.pathname.replace(/^\//, '').replace(/\/$/, '') || 'contacto';
    const page = useMemo(() => pages[slug] || pages.contacto, [slug]);
    const canonicalUrl = `https://www.shareway.es/${slug}/`;

    useEffect(() => {
        document.title = page.title;
        setMeta('description', page.description);
        setMeta('robots', 'index, follow');
        setMeta('og:title', page.title, true);
        setMeta('og:description', page.description, true);
        setMeta('og:url', canonicalUrl, true);
        setMeta('twitter:title', page.title);
        setMeta('twitter:description', page.description);
        updateCanonical(canonicalUrl);
    }, [page, canonicalUrl]);

    return (
        <main className="min-h-screen bg-slate-50 text-slate-950 px-6 py-12">
            <div className="max-w-3xl mx-auto">
                <Link to="/" className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-500 hover:text-slate-950 mb-8">
                    <ArrowLeft className="h-4 w-4" /> Volver a ShareWay
                </Link>

                <section className="rounded-3xl bg-white border border-slate-100 shadow-xl p-8 sm:p-10">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-12 w-12 rounded-2xl bg-slate-950 text-white flex items-center justify-center">
                            {slug === 'contacto' ? <Mail className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-600">ShareWay</p>
                    </div>

                    <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mb-4">{page.h1}</h1>
                    <p className="text-lg text-slate-600 leading-relaxed mb-10">{page.description}</p>

                    <div className="space-y-8">
                        {page.sections.map((section) => (
                            <article key={section.heading} className="space-y-3">
                                <h2 className="text-2xl font-black tracking-tight">{section.heading}</h2>
                                {section.paragraphs.map((paragraph) => (
                                    <p key={paragraph} className="text-slate-600 leading-relaxed">{paragraph}</p>
                                ))}
                            </article>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
};

export default LegalPage;
