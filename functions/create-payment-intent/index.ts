// Importa las dependencias necesarias.
// `serve` para crear el servidor y `Stripe` para interactuar con la API de Stripe.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@10.17.0";

// Inicializa el cliente de Stripe de forma segura, leyendo la clave secreta
// desde las variables de entorno del servidor, nunca desde el código.
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2022-11-15",
});

// Define las cabeceras CORS para permitir que tu aplicación web (que se ejecuta
// en localhost o en tu dominio) pueda llamar a esta función de backend.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Para producción, reemplaza '*' por tu dominio real (ej: "https://www.myapp.com")
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inicia el servidor de la función.
serve(async (req) => {
  // Maneja la petición 'OPTIONS' (preflight) que los navegadores envían
  // antes de la petición real para verificar los permisos CORS.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parsea el cuerpo de la petición para obtener los datos enviados desde el frontend.
    const { amount, user_id } = await req.json();

    // Valida los datos recibidos.
    if (!amount || amount < 5) {
      throw new Error("El importe debe ser de al menos 5.00 €.");
    }
    if (!user_id) {
      throw new Error("El ID de usuario es obligatorio para crear un pago.");
    }

    // Crea la "intención de pago" (PaymentIntent) en Stripe.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe funciona con céntimos, por lo que multiplicamos por 100.
      currency: "eur",
      automatic_payment_methods: { enabled: true }, // Permite a Stripe mostrar métodos de pago optimizados (tarjeta, Apple Pay, etc.).
      // **MUY IMPORTANTE**: Añadimos el ID del usuario en los metadatos.
      // Esto nos permitirá saber a quién acreditar el saldo más adelante.
      metadata: {
        user_id: user_id,
      },
    });

    // Devuelve únicamente el 'client_secret' al frontend. Este token es seguro
    // y permite al formulario de Stripe finalizar el pago sin exponer datos sensibles.
    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    // En caso de error, devuelve un mensaje claro y un estado 400.
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});