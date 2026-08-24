export const getRequestChatPeerId = ({ isMyRequest, requesterId, driverId }) => {
    const peerId = isMyRequest ? driverId : requesterId;
    if (!peerId) return null;
    return String(peerId);
};

export const getRequestChatPath = ({ linkedRideId, chatId }) => {
    if (!chatId) return null;
    if (linkedRideId) return `/rides/${linkedRideId}/chat/${chatId}`;
    return `/chat/${chatId}`;
};

export const extractChatId = (payload) => {
    if (typeof payload === 'string' && payload.trim()) return payload.trim();
    return payload?.chatId
        || payload?.chat_id
        || payload?.id
        || payload?.data?.chatId
        || payload?.data?.chat_id
        || payload?.data?.id
        || null;
};
