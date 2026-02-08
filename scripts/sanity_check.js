import { createRequire } from 'module';
const require = createRequire(import.meta.url);

try {
    const clsx = require('clsx');
    // Handle different clsx export structures
    const clsxVersion = require('clsx/package.json').version;
    console.log('clsx version:', clsxVersion);
    console.log('clsx type:', typeof clsx.clsx || typeof clsx);
} catch (e) {
    console.error('Error loading clsx:', e.message);
}

try {
    const radixLabel = require('@radix-ui/react-label');
    console.log('Radix Label loaded successfully');
} catch (e) {
    console.error('Error loading @radix-ui/react-label:', e.message);
}

try {
    const tailwindMerge = require('tailwind-merge');
    console.log('Tailwind Merge loaded');
} catch (e) {
    console.error('Error loading tailwind-merge:', e.message);
}
