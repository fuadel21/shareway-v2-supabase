import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// Import the components we fixed
import Account from '../Account';
import EmergencyChat from '../EmergencyChat';
import Chat from '../Chat';
import DisputeHistory from '../DisputeHistory';

// Mocking useOutletContext
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useOutletContext: () => ({
            user: { id: 'test-user' },
            profile: {
                id: 'test-user',
                display_name: 'Test User',
                verification: { status: 'verified' },
                preferences: { smoking: 'no', pets: 'yes', music: 'yes', talkativeness: 'yes' },
                security_settings: { share_trip_enabled: true }
            },
            handleSignOut: vi.fn(),
            refreshProfile: vi.fn(),
        }),
        useParams: () => ({ chatId: 'test-chat', rideId: 'test-ride' }),
    };
});

// Mocking useTranslation
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (str) => str,
        i18n: { language: 'es' },
    }),
}));

// Mocking useWallet
vi.mock('../../hooks/useWallet', () => ({
    useWallet: () => ({
        wallet: { balance: 100, heldBalance: 0 },
        loadingWallet: false,
        refreshWallet: vi.fn(),
    }),
}));

// Mocking supabase
vi.mock('@/lib/supabase', () => ({
    supabase: {
        auth: {
            getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'test' } }, error: null })),
        },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            single: vi.fn().mockImplementation(() => Promise.resolve({ data: {}, error: null })),
            contains: vi.fn().mockReturnThis(),
        })),
        channel: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnThis(),
            unsubscribe: vi.fn(),
        })),
    },
}));

describe('Fixed Components Integrity Test', () => {
    it('Account renders and displays profile info', async () => {
        render(<MemoryRouter><Account /></MemoryRouter>);
        expect(await screen.findByText(/Test User/i)).toBeInTheDocument();
    });

    it('EmergencyChat renders correctly after loading', async () => {
        render(<MemoryRouter><EmergencyChat /></MemoryRouter>);
        // Wait for loader to disappear or header to appear
        expect(await screen.findByText(/Canal de Auxilio/i)).toBeInTheDocument();
    });

    it('Chat renders correctly', async () => {
        render(<MemoryRouter><Chat /></MemoryRouter>);
        expect(await screen.findByText(/Protocolo de Mensajería Blindada/i)).toBeInTheDocument();
    });

    it('DisputeHistory renders correctly after loading', async () => {
        render(<MemoryRouter><DisputeHistory /></MemoryRouter>);
        expect(await screen.findByText(/Centro de Apelaciones/i)).toBeInTheDocument();
    });
});
