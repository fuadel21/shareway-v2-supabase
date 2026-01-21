/**
 * Clase de error personalizada para errores de la aplicación.
 * Permite encapsular errores con un código y detalles adicionales.
 */
export class AppError extends Error {
    /**
     * @param {string} code - Un código único para el tipo de error (e.g., 'auth/not-found').
     * @param {string} message - El mensaje de error principal.
     * @param {object} [details] - Detalles adicionales sobre el error.
     */
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Procesa errores de Firebase y de la aplicación para crear un error unificado.
 * Esta función NO causa efectos secundarios como mostrar notificaciones.
 *
 * @param {Error} error - El objeto de error capturado.
 * @param {string} [context] - Describe dónde ocurrió el error (e.g., 'al crear el viaje').
 * @returns {AppError} Un nuevo error de la aplicación con un mensaje amigable.
 */
export const handleFirebaseError = (error, context = 'en la operación') => {
    let errorMessage = `Ocurrió un error ${context}.`;
    let errorCode = 'unknown';

    if (error instanceof AppError) {
        // Si ya es un AppError, lo devolvemos tal cual.
        return error;
    } 
    
    if (error.code) { // Error de Firebase
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = "No se encontró una cuenta con ese email.";
                break;
            case 'auth/wrong-password':
                errorMessage = "La contraseña es incorrecta.";
                break;
            case 'auth/email-already-in-use':
                errorMessage = "Ya existe una cuenta con este correo.";
                break;
            case 'permission-denied':
                errorMessage = "No tienes permiso para realizar esta acción.";
                break;
            default:
                errorMessage = "Ocurrió un error inesperado. Inténtalo de nuevo.";
        }
        errorCode = error.code;
    } else {
        // Para errores genéricos de Javascript, usamos su mensaje si existe
        if(error.message) errorMessage = error.message;
    }

    console.error(`[Error: ${errorCode}] ${context}:`, error);

    // Devolvemos un nuevo AppError que será capturado por el componente
    return new AppError(errorCode, errorMessage);
};
