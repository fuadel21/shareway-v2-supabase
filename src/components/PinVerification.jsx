import { ShieldQuestion } from 'lucide-react';

const PinVerification = () => {
  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <h1 className="text-3xl font-bold text-gray-800 my-6">Verificación por PIN</h1>
      
      <div className="text-center text-gray-500 py-20 bg-gray-50 rounded-lg">
        <ShieldQuestion className="mx-auto h-16 w-16 text-gray-400" />
        <h2 className="mt-6 text-xl font-semibold">Próximamente</h2>
        <p className="mt-2 text-base">Con esta función, recibirás un PIN único para verificar que estás subiendo al coche del conductor correcto.</p>
      </div>
    </div>
  );
};

export default PinVerification;
