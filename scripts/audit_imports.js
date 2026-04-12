import fs from 'fs';
import path from 'path';

const srcDir = './src';

function getFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    fs.readdirSync(dir).forEach(file => {
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== '__tests__') {
                getFiles(name, files);
            }
        } else if (file.endsWith('.jsx') || file.endsWith('.js')) {
            files.push(name);
        }
    });
    return files;
}

const issues = [];
const files = getFiles(srcDir);

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');

    // Potential Component Usage
    const tags = new Set();

    // 1. JSX Tags: <Component ... /> or <Namespace.Component ... />
    const tagRegex = /<([A-Z][a-zA-Z0-9]*)(?:\.[a-zA-Z0-9]+)?\b/g;
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
        tags.add(match[1]);
    }

    // 2. Props: icon={Component}
    const propRegex = /=[{]\s*([A-Z][a-zA-Z0-9]*)\s*[}]/g;
    while ((match = propRegex.exec(content)) !== null) {
        tags.add(match[1]);
    }

    const definedNames = new Set();

    // 1. Imports (Handle multi-line and aliases)
    const importRegex = /import\s+([\s\S]*?)\s+from\s+['"].*?['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
        const block = importMatch[1];

        // Named imports: { A, B as C }
        const bracketMatch = block.match(/\{([\s\S]*?)\}/);
        if (bracketMatch) {
            bracketMatch[1].split(',').forEach(s => {
                const item = s.trim();
                if (!item) return;
                // Handle "B as C" -> C
                const parts = item.split(/\bws+as\b/);
                // More robust alias check
                const aliasMatch = item.match(/(\w+)\s+as\s+(\w+)/);
                if (aliasMatch) {
                    definedNames.add(aliasMatch[2]);
                } else {
                    definedNames.add(item.split(/\s+/)[0]);
                }
            });
        }

        // Default & Namespace imports
        // Remove brackets to find what's outside
        const outside = block.replace(/\{[\s\S]*?\}/, '').trim();
        if (outside) {
            outside.split(',').forEach(s => {
                const part = s.trim();
                if (part.startsWith('*')) {
                    const nsMatch = part.match(/\*\s+as\s+(\w+)/);
                    if (nsMatch) definedNames.add(nsMatch[1]);
                } else if (part) {
                    definedNames.add(part);
                }
            });
        }
    }

    // 2. Local Declarations & Parameters
    // This is hard with regex, but let's catch the basics
    const declRegex = /\b(const|let|var|function|class)\s+([a-zA-Z0-9_]+)/g;
    while ((match = declRegex.exec(content)) !== null) {
        definedNames.add(match[2]);
    }

    // Parameters of functions: ( { icon: Icon } ) or ( Icon )
    const paramRegex = /(?:function\s+\w*|=>)\s*\(([\s\S]*?)\)/g;
    while ((match = paramRegex.exec(content)) !== null) {
        const paramsBlock = match[1];
        // Search for uppercase names in params
        const upperInParams = paramsBlock.match(/\b([A-Z][a-zA-Z0-9]*)\b/g);
        if (upperInParams) upperInParams.forEach(p => definedNames.add(p));
    }

    // Destructuring
    const destructuringRegex = /\{(.*?)\}\s*(?:=|\:)/g;
    while ((match = destructuringRegex.exec(content)) !== null) {
        const items = match[1].match(/\b([a-zA-Z0-9_]+)\b/g);
        if (items) items.forEach(i => definedNames.add(i));
    }

    const globals = [
        'React', 'console', 'window', 'localStorage', 'setTimeout', 'clearTimeout',
        'setInterval', 'clearInterval', 'Math', 'JSON', 'Error', 'Promise', 'Intl',
        'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Map', 'Set',
        'fetch', 'navigator', 'document', 'location', 'history', 'alert', 'confirm',
        'process', 'FormData', 'Blob', 'File', 'Image', 'Audio', 'URL', 'Intl', 'Buffer', 'URLSearchParams'
    ];
    globals.forEach(g => definedNames.add(g));

    tags.forEach(tag => {
        if (!definedNames.has(tag)) {
            issues.push({ file, tag, reason: 'Potentially missing import/definition' });
        }
    });
});

if (issues.length > 0) {
    // Unique issues per file
    const uniqueIssues = [];
    const seen = new Set();
    issues.forEach(i => {
        const key = `${i.file}:${i.tag}`;
        if (!seen.has(key)) {
            uniqueIssues.push(i);
            seen.add(key);
        }
    });

    console.log(`Found ${uniqueIssues.length} unique potential ReferenceErrors:`);
    console.table(uniqueIssues);
    process.exit(1);
} else {
    console.log('✅ Referential integrity check passed.');
}
