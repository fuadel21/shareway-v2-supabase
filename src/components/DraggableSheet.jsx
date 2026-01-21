import { BottomSheet } from 'react-spring-bottom-sheet';
import 'react-spring-bottom-sheet/dist/style.css';

/**
 * Componente reutilizable para un panel inferior deslizable.
 * Envuelve la librería `react-spring-bottom-sheet` para una integración sencilla.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - El contenido que se mostrará dentro del panel.
 */
export function DraggableSheet({ children }) {
    return (
        <BottomSheet 
            open={true} 
            blocking={false} // Permite interactuar con el mapa mientras el panel está abierto
            // Puntos de "snap" o anclaje del panel:
            snapPoints={({ minHeight, maxHeight }) => [
                120,       // Punto inicial (semi-abierto)
                maxHeight * 0.6, // Punto intermedio (60% de la altura)
            ]}
            // Altura por defecto al cargar
            defaultSnap={({ lastSnap, snapPoints }) => lastSnap ?? snapPoints[0]}
            // Estilos para el contenedor principal
            className="z-20"
        >
            {children}
        </BottomSheet>
    );
}
