import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
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
            '@': path.resolve(__dirname, './src'),
        },
    },
    optimizeDeps: {
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
            'sonner',
            'clsx',
            'tailwind-merge'
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
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['src/test/setup.ts'],
        globals: true,
        testTimeout: 60000, // 60 seconds for integration tests with auth
        include: ['src/**/*.test.{js,jsx,ts,tsx}'],
        exclude: ['e2e/**', 'node_modules/**'],
        fileParallelism: false,
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: ['node_modules/**', 'src/test/**', 'e2e/**']
        }
    }
});
