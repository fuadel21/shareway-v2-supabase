import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig(({ mode }) => {
    const isTest = mode === 'test';

    return {
        plugins: [react()],
        define: isTest ? {
            'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://shareway-test.supabase.co'),
            'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key-for-local-vitest-only'),
        } : undefined,
        esbuild: {
            loader: 'jsx',
            include: /src\/.*\.[jt]sx?$/,
            exclude: [],
        },
        server: {
            port: 5173,
            strictPort: true,
            hmr: {
                protocol: 'ws',
                host: 'localhost',
                port: 5173,
            },
        },
        test: {
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.js'],
            restoreMocks: true,
            clearMocks: true,
        },
        css: {
            postcss: {
                plugins: [
                    tailwindcss('./tailwind.config.js'),
                    autoprefixer,
                ],
            },
        },
        resolve: {
            alias: {
                '@': path.join(process.cwd(), 'src'),
            },
            extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
        },
        optimizeDeps: {
            esbuildOptions: {
                loader: {
                    '.js': 'jsx',
                },
            },
            include: [
                'clsx',
                'tailwind-merge',
                'class-variance-authority',
                '@radix-ui/react-label',
                '@radix-ui/react-slot',
                '@radix-ui/react-popover',
                '@radix-ui/react-dialog',
                '@radix-ui/react-scroll-area',
                '@radix-ui/react-avatar',
                '@radix-ui/react-tabs',
                '@radix-ui/react-select',
                '@radix-ui/react-dropdown-menu',
                '@radix-ui/react-alert-dialog',
                'lucide-react',
                'date-fns',
                '@supabase/supabase-js',
                'leaflet',
                'react-leaflet',
                'leaflet-defaulticon-compatibility',
                'sonner'
            ],
        },
        build: {
            chunkSizeWarningLimit: 1600,
            rollupOptions: {
                output: {
                    manualChunks: {
                        'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                        'ui-vendor': ['lucide-react', 'class-variance-authority', 'tailwind-merge'],
                        'radix': [
                            '@radix-ui/react-label',
                            '@radix-ui/react-slot',
                            '@radix-ui/react-popover',
                            '@radix-ui/react-dialog',
                            '@radix-ui/react-scroll-area',
                            '@radix-ui/react-avatar',
                            '@radix-ui/react-tabs',
                            '@radix-ui/react-select',
                            '@radix-ui/react-dropdown-menu',
                            '@radix-ui/react-alert-dialog'
                        ],
                        'maps': ['leaflet', 'react-leaflet', 'leaflet-defaulticon-compatibility'],
                        'supabase': ['@supabase/supabase-js'],
                        'date': ['date-fns'],
                        'notify': ['sonner']
                    }
                }
            }
        }
    };
});