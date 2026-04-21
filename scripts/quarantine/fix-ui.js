import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filesToFix = [
    'components/Layout.tsx',
    'pages/Dashboard.tsx',
    'components/DataTable.tsx',
    'pages/CRM.tsx'
];

filesToFix.forEach(relPath => {
    const filePath = path.join(__dirname, '..', relPath);
    if (!fs.existsSync(filePath)) {
        console.log('Skipping', filePath);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // 字体排版修复
    content = content.replace(/text-\[8px\]/g, 'text-xs');
    content = content.replace(/text-\[9px\]/g, 'text-xs');
    content = content.replace(/text-\[10px\]/g, 'text-xs');
    content = content.replace(/text-\[11px\]/g, 'text-sm');
    
    // 间距和加粗修复
    content = content.replace(/tracking-widest/g, 'tracking-wider');
    content = content.replace(/tracking-\[0\.2em\]/g, ''); 
    content = content.replace(/tracking-\[0\.25em\]/g, '');
    
    // 移动端/大容器巨大的圆角修复
    content = content.replace(/rounded-\[48px\]/g, 'rounded-3xl');
    content = content.replace(/rounded-\[40px\]/g, 'rounded-2xl');
    content = content.replace(/rounded-\[36px\]/g, 'rounded-2xl');
    content = content.replace(/rounded-\[32px\]/g, 'rounded-2xl');
    
    // Layout 中特定 mobile dock 过小过挤的 fixed 问题
    content = content.replace(/w-16 h-16/g, 'w-auto h-auto px-4 py-2 flex-wrap'); 
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Fixed:', relPath);
});
