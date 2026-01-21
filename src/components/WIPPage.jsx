import { HardHat } from 'lucide-react';

const WIPPage = ({ section }) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 md:p-12 min-h-[400px]">
      <HardHat className="h-16 w-16 text-yellow-500 mb-4" />
      <h1 className="text-2xl font-bold text-foreground mb-2">
        Sección en Construcción
      </h1>
      <p className="text-muted-foreground max-w-md">
        Estamos trabajando para traerte esta funcionalidad lo antes posible. 
        {section && <span className='font-semibold'>{`La sección de ${section} estará disponible en futuras actualizaciones.`}</span>}
      </p>
    </div>
  );
};

export default WIPPage;
