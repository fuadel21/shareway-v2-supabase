import { describe, it, expect } from 'vitest';
import { extractChatId, getRequestChatPath, getRequestChatPeerId } from '../requestChat';

describe('requestChat', () => {
    it('opens a private chat with the requester when the viewer is a driver', () => {
        expect(getRequestChatPeerId({
            isMyRequest: false,
            requesterId: 'pax-1',
            driverId: 'driver-1',
        })).toBe('pax-1');
    });

    it('opens a private chat with the driver when the viewer owns the request', () => {
        expect(getRequestChatPeerId({
            isMyRequest: true,
            requesterId: 'pax-1',
            driverId: 'driver-1',
        })).toBe('driver-1');
    });

    it('prefers the ride chat route when a linked ride exists', () => {
        expect(getRequestChatPath({ linkedRideId: 'ride-9', chatId: 'chat-3' }))
            .toBe('/rides/ride-9/chat/chat-3');
        expect(getRequestChatPath({ linkedRideId: null, chatId: 'chat-3' }))
            .toBe('/chat/chat-3');
    });

    it('extracts chat ids from nested RPC payloads', () => {
        expect(extractChatId({ chatId: 'chat-1' })).toBe('chat-1');
        expect(extractChatId({ data: { chat_id: 'chat-2' } })).toBe('chat-2');
        expect(extractChatId('chat-3')).toBe('chat-3');
        expect(extractChatId({ id: 'chat-4' })).toBe('chat-4');
    });

    it('does not open a chat without a peer', () => {
        expect(getRequestChatPeerId({
            isMyRequest: true,
            requesterId: 'pax-1',
            driverId: null,
        })).toBeNull();
    });
});
