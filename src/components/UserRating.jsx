import { Star, StarHalf } from 'lucide-react';

// Renders a star rating display based on a numerical rating.
export function UserRating({ rating = 0, totalStars = 5, size = 16 }) {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5 ? 1 : 0;
    const emptyStars = totalStars - fullStars - halfStar;

    return (
        <div className="flex items-center" title={`${rating.toFixed(1)} de ${totalStars} estrellas`}>
            {/* Full Stars */}
            {Array.from({ length: fullStars }, (_, i) => (
                <Star key={`full-${i}`} className="text-yellow-400 fill-yellow-400" size={size} />
            ))}
            {/* Half Star */}
            {halfStar === 1 && (
                <StarHalf key="half" className="text-yellow-400 fill-yellow-400" size={size} />
            )}
            {/* Empty Stars */}
            {Array.from({ length: emptyStars }, (_, i) => (
                <Star key={`empty-${i}`} className="text-gray-300" size={size} />
            ))}
        </div>
    );
}
