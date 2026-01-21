import { Share2 } from 'lucide-react';

const ShareMyTrip = () => {
  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <h1 className="text-3xl font-bold text-gray-800 my-6">Compartir Mi Viaje</h1>
      
      <div className="text-center text-gray-500 py-20 bg-gray-50 rounded-lg">
        <Share2 className="mx-auto h-16 w-16 text-gray-400" />
        <h2 className="mt-6 text-xl font-semibold">Próximamente</h2>
        <p className="mt-2 text-base">Desde aquí podrás compartir un enlace con tus contactos para que sigan tu viaje en tiempo real.</p>
      </div>
    </div>
  );
};

export default ShareMyTrip;
