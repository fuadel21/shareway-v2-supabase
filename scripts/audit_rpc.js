import fs from 'fs';
import path from 'path';

const srcDir = './src';
const supabaseDir = './supabase';

function getFiles(dir, ext, files = []) {
    if (!fs.existsSync(dir)) return files;
    fs.readdirSync(dir).forEach(file => {
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, ext, files);
        } else if (file.endsWith(ext)) {
            files.push(name);
        }
    });
    return files;
}

const jsFiles = getFiles(srcDir, '.js').concat(getFiles(srcDir, '.jsx'));
const sqlFiles = getFiles(supabaseDir, '.sql');

console.log(`Auditing ${jsFiles.length} JS/JSX files against ${sqlFiles.length} SQL files...`);

const rpcInCode = [];
const rpcInSql = {};

// 1. Extract RPCs from Code
jsFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const rpcRegex = /\.rpc\(['"](.*?)['"](?:,\s*\{([\s\S]*?)\})?/g;
    let match;
    while ((match = rpcRegex.exec(content)) !== null) {
        const name = match[1];
        const rawParams = match[2] || '';
        const params = rawParams.split(',').map(p => p.trim().split(':')[0].trim()).filter(p => !p.startsWith('//') && p !== '');
        rpcInCode.push({ file, name, params });
    }
});

// 2. Extract Functions from SQL
sqlFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)/gi;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
        const name = match[1];
        const rawArgs = match[2] || '';
        const args = rawArgs.split(',').map(a => {
            const parts = a.trim().split(/\s+/);
            const argName = parts[0].startsWith('p_') ? parts[0] : parts[0];
            return argName.toLowerCase().replace('p_', '');
        }).filter(a => a !== '');

        // We store the latest version found (multiple files might define the same func)
        rpcInSql[name.toLowerCase()] = { file, args: args.map(a => a.toLowerCase()) };
    }
});

console.log(`Found ${rpcInCode.length} RPC calls in code.`);
console.log(`Found ${Object.keys(rpcInSql).length} unique functions in SQL.`);

const mismatches = [];

rpcInCode.forEach(call => {
    const sqlFunc = rpcInSql[call.name.toLowerCase()];
    if (!sqlFunc) {
        mismatches.push({
            type: 'MISSING_FUNCTION',
            name: call.name,
            file: call.file,
            details: 'Function not found in any SQL file'
        });
        return;
    }

    // Check if expected parameters exist
    call.params.forEach(param => {
        const cleanParam = param.replace(/^p_/, '').toLowerCase();
        // Skip dynamic params or complex objects for now
        if (param.includes('.') || param.includes('[') || param === 'body') return;

        if (!sqlFunc.args.includes(cleanParam)) {
            mismatches.push({
                type: 'PARAM_MISMATCH',
                name: call.name,
                file: call.file,
                details: `Parameter "${param}" not found in SQL definition (SQL args: ${sqlFunc.args.join(', ')})`
            });
        }
    });
});

if (mismatches.length > 0) {
    console.log('\n❌ RPC Mismatches Found:');
    console.table(mismatches);
    process.exit(1);
} else {
    console.log('\n✅ No RPC mismatches found.');
}
