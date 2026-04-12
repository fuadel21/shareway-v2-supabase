import fs from 'fs';
import path from 'path';

const componentsDir = './src/components';

function getFiles(dir, files = []) {
    fs.readdirSync(dir).forEach(file => {
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files);
        } else if (file.endsWith('.jsx')) {
            files.push(name);
        }
    });
    return files;
}

const SHADCN_FAMILIES = {
    'Dialog': ['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter', 'DialogTrigger'],
    'AlertDialog': ['AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle', 'AlertDialogTrigger'],
    'Card': ['Card', 'CardContent', 'CardHeader', 'CardTitle', 'CardDescription', 'CardFooter'],
    'Tabs': ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'],
    'Accordion': ['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'],
};

const issues = [];

const files = getFiles(componentsDir);

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');

    // Skip the UI components themselves
    if (file.includes('ui/')) return;

    // Improved import detection: join all import blocks
    const importBlocks = content.match(/import\s+[\s\S]*?from\s+['"].*?['"]/g) || [];
    const allImportsText = importBlocks.join('\n');

    Object.entries(SHADCN_FAMILIES).forEach(([family, members]) => {
        members.forEach(member => {
            const tagRegex = new RegExp(`<${member}\\b`, 'g');
            const importRegex = new RegExp(`\\b${member}\\b`, 'g');

            const hasTag = tagRegex.test(content);
            const isImported = importRegex.test(allImportsText);

            if (hasTag && !isImported) {
                issues.push({
                    file,
                    member,
                    reason: 'Used but not imported'
                });
            }
        });

        // Integrity check
        const rootTag = family === 'Dialog' ? '<Dialog' : family === 'AlertDialog' ? '<AlertDialog' : null;
        if (rootTag && content.includes(rootTag)) {
            const hasTitle = content.includes(family === 'Dialog' ? 'DialogTitle' : 'AlertDialogTitle');
            const hasDescription = content.includes(family === 'Dialog' ? 'DialogDescription' : 'AlertDialogDescription');

            if (!hasTitle) issues.push({ file, family, reason: 'Missing Title for accessibility' });
            if (!hasDescription) issues.push({ file, family, reason: 'Missing Description for accessibility' });
        }
    });
});

if (issues.length > 0) {
    console.log('Found issues in Shadcn component usage:');
    console.table(issues);
    process.exit(1);
} else {
    console.log('No Shadcn integrity issues found.');
}
