const TEXT_EXTENSIONS = new Set([
    'bat', 'bash', 'c', 'cc', 'cfg', 'conf', 'cpp', 'cs', 'css', 'csv', 'cxx', 'dockerfile', 'env', 'go',
    'graphql', 'h', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'kt', 'less', 'log', 'lua',
    'm', 'md', 'mdx', 'mm', 'php', 'pl', 'properties', 'py', 'rb', 'rs', 'sass', 'scss', 'sh', 'sql',
    'swift', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zsh'
]);

const TEXT_FILE_NAMES = new Set([
    '.env', '.gitignore', '.npmrc', '.nvmrc', '.prettierrc', '.watchmanconfig', 'dockerfile', 'makefile',
    'readme', 'license', 'changelog', 'authors', 'contributors'
]);

const BINARY_EXTENSIONS = new Set([
    '7z', 'aac', 'apk', 'avi', 'bmp', 'db', 'deb', 'dmg', 'doc', 'docx', 'exe', 'flac', 'gif', 'gz',
    'heic', 'ico', 'jpeg', 'jpg', 'mov', 'mp3', 'mp4', 'ogg', 'otf', 'pdf', 'png', 'ppt', 'pptx', 'rar',
    'rpm', 'sqlite', 'sqlite3', 'tar', 'ttf', 'wav', 'webm', 'webp', 'woff', 'woff2', 'xls', 'xlsx', 'zip'
]);

export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export function getFileName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() || path || 'file';
}

export function getFileExtension(path: string): string {
    const fileName = getFileName(path).toLowerCase();
    if (!fileName.includes('.')) {
        return fileName;
    }
    return fileName.split('.').pop() || '';
}

export function isKnownTextFile(path: string): boolean {
    const fileName = getFileName(path).toLowerCase();
    return TEXT_FILE_NAMES.has(fileName) || TEXT_EXTENSIONS.has(getFileExtension(path));
}

export function isKnownBinaryFile(path: string): boolean {
    return BINARY_EXTENSIONS.has(getFileExtension(path));
}

export function shouldPreviewAsText(path: string, size?: number): boolean {
    if (isKnownBinaryFile(path)) {
        return false;
    }
    if (size !== undefined && size > TEXT_PREVIEW_MAX_BYTES && !isKnownTextFile(path)) {
        return false;
    }
    return isKnownTextFile(path) || size === undefined || size <= TEXT_PREVIEW_MAX_BYTES;
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function decodeUtf8Bytes(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

export function isLikelyBinaryBytes(bytes: Uint8Array, decodedText?: string): boolean {
    if (bytes.length === 0) {
        return false;
    }
    for (const byte of bytes) {
        if (byte === 0) {
            return true;
        }
    }
    const text = decodedText ?? decodeUtf8Bytes(bytes);
    if (text.length === 0) {
        return false;
    }
    let nonPrintableCount = 0;
    for (const char of text) {
        const code = char.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            nonPrintableCount += 1;
        }
    }
    return nonPrintableCount / text.length > 0.1;
}

export function formatFileSize(size?: number): string {
    if (size === undefined || Number.isNaN(size)) {
        return '';
    }
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${Math.round(size / 1024)} KB`;
    }
    if (size < 1024 * 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    }
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function joinRemotePath(parentPath: string, childName: string): string {
    if (!parentPath) {
        return childName;
    }
    if (parentPath.endsWith('/') || parentPath.endsWith('\\')) {
        return `${parentPath}${childName}`;
    }
    return `${parentPath}/${childName}`;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function getRelativeProjectPath(path: string, rootPath: string): string {
    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(rootPath);
    if (normalizedPath === normalizedRoot) {
        return '';
    }
    if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
        return normalizedPath.slice(normalizedRoot.length + 1);
    }
    return path;
}

export function getLanguageFromPath(path: string): string | null {
    const extension = getFileExtension(path);
    switch (extension) {
        case 'js':
        case 'jsx':
            return 'javascript';
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'py':
            return 'python';
        case 'html':
        case 'htm':
            return 'html';
        case 'css':
            return 'css';
        case 'json':
            return 'json';
        case 'md':
        case 'mdx':
            return 'markdown';
        case 'xml':
            return 'xml';
        case 'yaml':
        case 'yml':
            return 'yaml';
        case 'sh':
        case 'bash':
        case 'zsh':
            return 'bash';
        case 'sql':
            return 'sql';
        case 'go':
            return 'go';
        case 'rust':
        case 'rs':
            return 'rust';
        case 'java':
            return 'java';
        case 'c':
            return 'c';
        case 'cpp':
        case 'cc':
        case 'cxx':
            return 'cpp';
        case 'php':
            return 'php';
        case 'rb':
            return 'ruby';
        case 'swift':
            return 'swift';
        case 'kt':
            return 'kotlin';
        default:
            return null;
    }
}
