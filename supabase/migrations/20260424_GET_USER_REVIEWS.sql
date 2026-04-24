-- Función para obtener valoraciones detalladas de un usuario
CREATE OR REPLACE FUNCTION public.get_user_reviews(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_reviews JSONB;
BEGIN
    SELECT jsonb_agg(
        json_build_object(
            'id', r.id,
            'rating', r.rating,
            'comment', r.comment,
            'created_at', r.created_at,
            'sender_name', p.display_name,
            'sender_photo', p.photo_url,
            'ride_id', r.ride_id
        )
    ) INTO v_reviews
    FROM public.ride_ratings r
    JOIN public.profiles p ON r.sender_id = p.id
    WHERE r.receiver_id = p_user_id
    ORDER BY r.created_at DESC;

    RETURN json_build_object(
        'success', true,
        'reviews', COALESCE(v_reviews, '[]'::jsonb)
    );
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
